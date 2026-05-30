import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { NodeCapacityService } from "../services/NodeCapacityService";
import { buildNodeCapacityErrorViewModel } from "../shared/nodeCapacity/NodeCapacityDefaults";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { openJenkinsWorkbenchUrl } from "../ui/OpenExternalUrl";
import { NodeDetailsPanel } from "./NodeDetailsPanel";
import { renderLoadingHtml, renderNodeCapacityHtml } from "./nodeCapacity/NodeCapacityRenderer";
import {
  type NodeCapacityOutgoingMessage,
  isLoadNodeCapacityExecutorsMessage,
  isOpenExternalMessage,
  isOpenNodeDetailsMessage,
  isRefreshNodeCapacityMessage
} from "./nodeCapacity/shared/NodeCapacityPanelMessages";
import type { EnvironmentPanelRefreshHost } from "./shared/PanelRuntimeHelpers";
import {
  PanelLoadTracker,
  attachPanelLifecycle,
  bindEnvironmentRefresh,
  disposeEnvironmentScopedPanel,
  shouldRefreshEnvironmentScopedPanel
} from "./shared/PanelRuntimeHelpers";
import { resolvePanelWebviewAssetsOrError } from "./shared/webview/PanelViewHelpers";
import { getWebviewAssetsRoot } from "./shared/webview/WebviewAssets";
import {
  createMissingPanelAssetsMessages,
  createPanelRestoreMessages,
  resolveRestoredPanelEnvironment
} from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import { configureWebviewPanel } from "./shared/webview/WebviewPanelChrome";
import {
  createSerializedEnvironmentState,
  isSerializedEnvironmentState
} from "./shared/webview/WebviewPanelState";

type NodeCapacityRefreshHost = EnvironmentPanelRefreshHost;

const NODE_CAPACITY_VISIBLE_REFRESH_INTERVAL_MS = 10_000;

interface NodeCapacityPanelShowOptions {
  dataService: JenkinsDataService;
  environment: JenkinsEnvironmentRef;
  extensionUri: vscode.Uri;
  refreshHost?: NodeCapacityRefreshHost;
}

interface NodeCapacityPanelReviveOptions {
  dataService: JenkinsDataService;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
  refreshHost?: NodeCapacityRefreshHost;
}

export class NodeCapacityPanel {
  private static currentPanel: NodeCapacityPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshSubscription?: vscode.Disposable;
  private refreshTimer?: NodeJS.Timeout;
  private refreshHost?: NodeCapacityRefreshHost;
  private dataService?: JenkinsDataService;
  private capacityService?: NodeCapacityService;
  private environment?: JenkinsEnvironmentRef;
  private readonly loadTracker: PanelLoadTracker;
  private capacityRequestCount = 0;
  private hasRendered = false;
  private nonce = createNonce();

  static async show(options: NodeCapacityPanelShowOptions): Promise<void> {
    const { dataService, environment, extensionUri, refreshHost } = options;

    if (!NodeCapacityPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.nodeCapacity",
        "Node Capacity",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getWebviewAssetsRoot(extensionUri)]
        }
      );
      configureWebviewPanel(panel, extensionUri, "server");
      NodeCapacityPanel.currentPanel = new NodeCapacityPanel(panel, extensionUri);
    }

    const activePanel = NodeCapacityPanel.currentPanel;
    activePanel.dataService = dataService;
    activePanel.capacityService = new NodeCapacityService(dataService);
    activePanel.environment = environment;
    activePanel.setRefreshHost(refreshHost);
    activePanel.panel.title = "Node Capacity";
    activePanel.panel.reveal(undefined, true);
    await activePanel.load();
  }

  static async revive(
    panel: vscode.WebviewPanel,
    state: unknown,
    options: NodeCapacityPanelReviveOptions
  ): Promise<void> {
    configureWebviewPanel(panel, options.extensionUri, "server");
    panel.title = "Node Capacity";

    const revived = new NodeCapacityPanel(panel, options.extensionUri);
    NodeCapacityPanel.currentPanel = revived;
    revived.dataService = options.dataService;
    revived.capacityService = new NodeCapacityService(options.dataService);
    revived.setRefreshHost(options.refreshHost);

    const restored = await resolveRestoredPanelEnvironment({
      panel: revived.panel,
      extensionUri: revived.extensionUri,
      entryName: "nodeCapacity",
      state,
      isValidState: isSerializedEnvironmentState,
      environmentStore: options.environmentStore,
      messages: createPanelRestoreMessages({
        title: "Node Capacity",
        viewNoun: "node capacity view",
        reopenHint: "Open node capacity again from Jenkins Workbench to continue."
      })
    });
    if (!restored.ok) {
      return;
    }

    revived.environment = restored.environment;
    await revived.load();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.loadTracker = new PanelLoadTracker((value) =>
      this.postMessage({ type: "setLoading", value })
    );

    attachPanelLifecycle(this.panel, this.disposables, {
      onDispose: () => this.dispose(),
      onVisible: () => {
        if (!this.hasRendered) {
          return;
        }
        this.startVisibleRefreshTimer();
        void this.refreshCapacity({ skipLoading: true });
      }
    });
    this.panel.onDidChangeViewState(
      () => {
        if (!this.panel.visible) {
          this.stopVisibleRefreshTimer();
        }
      },
      null,
      this.disposables
    );
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (isRefreshNodeCapacityMessage(message)) {
          void this.refreshCapacity();
          return;
        }
        if (isOpenExternalMessage(message)) {
          void this.openExternalUrl(message.url);
          return;
        }
        if (isOpenNodeDetailsMessage(message)) {
          void this.openNodeDetails(message.nodeUrl, message.label);
          return;
        }
        if (isLoadNodeCapacityExecutorsMessage(message)) {
          void this.loadNodeExecutors(message.nodeUrls);
        }
      },
      null,
      this.disposables
    );
  }

  private dispose(): void {
    disposeEnvironmentScopedPanel({
      clearSingleton: () => {
        NodeCapacityPanel.currentPanel = undefined;
      },
      onDispose: () => {
        this.stopVisibleRefreshTimer();
        this.refreshSubscription = undefined;
      },
      refreshSubscription: this.refreshSubscription,
      disposables: this.disposables
    });
  }

  private async load(): Promise<void> {
    this.stopVisibleRefreshTimer();
    this.beginCapacityRequest();
    const token = this.loadTracker.nextToken();
    this.hasRendered = false;
    this.nonce = createNonce();
    this.loadTracker.resetLoadingRequests();
    try {
      const panelState = this.environment
        ? createSerializedEnvironmentState(this.environment)
        : undefined;

      const assets = resolvePanelWebviewAssetsOrError(
        this.panel,
        this.extensionUri,
        "nodeCapacity",
        {
          ...createMissingPanelAssetsMessages({
            title: "Node Capacity",
            panelLabel: "Node capacity",
            reopenHint: "Open node capacity again from Jenkins Workbench to continue."
          }),
          panelState
        }
      );
      if (!assets) {
        return;
      }
      const { scriptUri, styleUris } = assets;

      this.panel.webview.html = renderLoadingHtml({
        cspSource: this.panel.webview.cspSource,
        nonce: this.nonce,
        styleUris,
        panelState
      });

      const model = await this.fetchCapacity(token);
      if (!model || !this.loadTracker.isCurrent(token)) {
        return;
      }

      this.panel.webview.html = renderNodeCapacityHtml(model, {
        cspSource: this.panel.webview.cspSource,
        nonce: this.nonce,
        scriptUri,
        styleUris,
        panelState
      });
      this.hasRendered = true;
    } finally {
      this.endCapacityRequest();
      if (this.hasRendered) {
        this.startVisibleRefreshTimer();
      }
    }
  }

  private async refreshCapacity(options?: { skipLoading?: boolean }): Promise<void> {
    if (this.hasCapacityRequestInFlight) {
      return;
    }
    if (!this.hasRendered) {
      await this.load();
      return;
    }
    this.beginCapacityRequest();
    const token = this.loadTracker.nextToken();
    if (!options?.skipLoading) {
      this.loadTracker.beginLoading();
    }
    try {
      const model = await this.fetchCapacity(token);
      if (!model || !this.loadTracker.isCurrent(token)) {
        return;
      }
      this.postMessage({ type: "updateNodeCapacity", payload: model });
    } finally {
      if (!options?.skipLoading) {
        this.loadTracker.endLoading();
      }
      this.endCapacityRequest();
    }
  }

  private async fetchCapacity(token: number) {
    if (!this.capacityService || !this.environment) {
      return undefined;
    }
    try {
      const model = await this.capacityService.getNodeCapacity(this.environment);
      if (!this.loadTracker.isCurrent(token)) {
        return undefined;
      }
      return model;
    } catch (error) {
      if (!this.loadTracker.isCurrent(token)) {
        return undefined;
      }
      return buildNodeCapacityErrorViewModel(this.environment.url, [formatActionError(error)]);
    }
  }

  private postMessage(message: NodeCapacityOutgoingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async openExternalUrl(url: string): Promise<void> {
    await openJenkinsWorkbenchUrl(url, "Node Capacity");
  }

  private async openNodeDetails(nodeUrl: string, label?: string): Promise<void> {
    if (!this.dataService || !this.environment) {
      return;
    }
    await NodeDetailsPanel.show({
      dataService: this.dataService,
      environment: this.environment,
      nodeUrl,
      extensionUri: this.extensionUri,
      label,
      refreshHost: this.refreshHost
    });
  }

  private async loadNodeExecutors(nodeUrls: string[]): Promise<void> {
    if (!this.capacityService || !this.environment) {
      return;
    }
    const capacityService = this.capacityService;
    const environment = this.environment;
    const token = this.loadTracker.currentToken;
    const environmentId = environment.environmentId;
    const uniqueNodeUrls = [...new Set(nodeUrls.filter((nodeUrl) => nodeUrl.trim().length > 0))];
    if (uniqueNodeUrls.length === 0) {
      return;
    }
    try {
      const entries = await capacityService.hydrateNodeExecutors(environment, uniqueNodeUrls);
      if (!this.loadTracker.isCurrent(token) || this.environment?.environmentId !== environmentId) {
        return;
      }
      this.postMessage({ type: "updateNodeCapacityNodeExecutors", payload: entries });
    } catch (error) {
      if (!this.loadTracker.isCurrent(token) || this.environment?.environmentId !== environmentId) {
        return;
      }
      void vscode.window.showErrorMessage(
        `Failed to load node executor details: ${formatActionError(error)}`
      );
    }
  }

  private setRefreshHost(refreshHost?: NodeCapacityRefreshHost): void {
    this.refreshHost = refreshHost;
    this.refreshSubscription = bindEnvironmentRefresh(
      this.refreshSubscription,
      refreshHost,
      (environmentId) => this.handleEnvironmentRefresh(environmentId)
    );
  }

  private async handleEnvironmentRefresh(environmentId?: string): Promise<void> {
    if (
      !shouldRefreshEnvironmentScopedPanel({
        environment: this.environment,
        environmentId,
        hasRendered: this.hasRendered,
        requireVisible: true,
        panel: this.panel
      })
    ) {
      return;
    }
    await this.refreshCapacity({ skipLoading: true });
  }

  private startVisibleRefreshTimer(): void {
    if (!this.panel.visible || this.refreshTimer || this.hasCapacityRequestInFlight) {
      return;
    }
    // Capacity combines queue and node calls, so it polls only while visible and uses a named
    // interval matching the default queue cadence instead of joining always-on background pollers.
    this.refreshTimer = setInterval(() => {
      if (this.panel.visible) {
        void this.refreshCapacity({ skipLoading: true });
      }
    }, NODE_CAPACITY_VISIBLE_REFRESH_INTERVAL_MS);
  }

  private stopVisibleRefreshTimer(): void {
    if (!this.refreshTimer) {
      return;
    }
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private get hasCapacityRequestInFlight(): boolean {
    return this.capacityRequestCount > 0;
  }

  private beginCapacityRequest(): void {
    this.capacityRequestCount += 1;
  }

  private endCapacityRequest(): void {
    this.capacityRequestCount = Math.max(0, this.capacityRequestCount - 1);
  }
}

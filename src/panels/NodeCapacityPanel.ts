import * as vscode from "vscode";
import type {
  EnvironmentScopedRefreshHost,
  ExtensionRefreshHost
} from "../extension/ExtensionRefreshHost";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { NodeCapacityService } from "../services/NodeCapacityService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { openExternalHttpUrlWithWarning } from "../ui/OpenExternalUrl";
import { NodeDetailsPanel } from "./NodeDetailsPanel";
import { renderLoadingHtml, renderNodeCapacityHtml } from "./nodeCapacity/NodeCapacityRenderer";
import {
  type NodeCapacityOutgoingMessage,
  isLoadNodeCapacityExecutorsMessage,
  isOpenExternalMessage,
  isOpenNodeDetailsMessage,
  isRefreshNodeCapacityMessage
} from "./nodeCapacity/shared/NodeCapacityPanelMessages";
import {
  attachPanelLifecycle,
  beginLoadingRequest,
  bindEnvironmentRefresh,
  disposePanelResources,
  endLoadingRequest
} from "./shared/PanelRuntimeHelpers";
import { getWebviewAssetsRoot, resolveWebviewAssets } from "./shared/webview/WebviewAssets";
import { renderPanelRestoreErrorHtml } from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import { configureWebviewPanel } from "./shared/webview/WebviewPanelChrome";
import {
  type SerializedEnvironmentState,
  isSerializedEnvironmentState,
  resolveEnvironmentRef
} from "./shared/webview/WebviewPanelState";

type NodeCapacityRefreshHost = EnvironmentScopedRefreshHost &
  Pick<ExtensionRefreshHost, "onDidRefreshEnvironment">;

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
  private loadToken = 0;
  private hasRendered = false;
  private nonce = createNonce();
  private loadingRequests = 0;

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
      NodeCapacityPanel.configurePanel(panel, extensionUri);
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
    NodeCapacityPanel.configurePanel(panel, options.extensionUri);
    panel.title = "Node Capacity";

    const revived = new NodeCapacityPanel(panel, options.extensionUri);
    NodeCapacityPanel.currentPanel = revived;
    revived.dataService = options.dataService;
    revived.capacityService = new NodeCapacityService(options.dataService);
    revived.setRefreshHost(options.refreshHost);

    if (!isSerializedEnvironmentState(state)) {
      revived.renderRestoreError(
        "This node capacity view could not be restored. Reopen it from Jenkins Workbench."
      );
      return;
    }

    const environment = await resolveEnvironmentRef(options.environmentStore, state);
    if (!environment) {
      revived.renderRestoreError(
        "This node capacity view could not be restored because its Jenkins environment was removed.",
        state
      );
      return;
    }

    revived.environment = environment;
    await revived.load();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    attachPanelLifecycle(this.panel, this.disposables, {
      onDispose: () => this.dispose(),
      onVisible: () => {
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
    NodeCapacityPanel.currentPanel = undefined;
    this.stopVisibleRefreshTimer();
    if (this.refreshSubscription) {
      this.refreshSubscription.dispose();
      this.refreshSubscription = undefined;
    }
    disposePanelResources(this.disposables);
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.hasRendered = false;
    this.nonce = createNonce();
    this.loadingRequests = 0;
    const panelState = this.environment ? createPanelState(this.environment) : undefined;

    let scriptUri: string;
    let styleUris: string[];
    try {
      ({ scriptUri, styleUris } = resolveWebviewAssets(
        this.panel.webview,
        this.extensionUri,
        "nodeCapacity"
      ));
    } catch {
      this.renderRestoreError(
        "Node capacity webview assets are missing. Run the extension build (npm run compile) and try again.",
        panelState
      );
      return;
    }

    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: this.nonce,
      styleUris,
      panelState
    });

    const model = await this.fetchCapacity(token);
    if (!model || !this.isTokenCurrent(token)) {
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
    this.startVisibleRefreshTimer();
  }

  private async refreshCapacity(options?: { skipLoading?: boolean }): Promise<void> {
    if (!this.hasRendered) {
      await this.load();
      return;
    }
    const token = ++this.loadToken;
    if (!options?.skipLoading) {
      this.beginLoading();
    }
    try {
      const model = await this.fetchCapacity(token);
      if (!model || !this.isTokenCurrent(token)) {
        return;
      }
      this.postMessage({ type: "updateNodeCapacity", payload: model });
    } finally {
      if (!options?.skipLoading) {
        this.endLoading();
      }
    }
  }

  private async fetchCapacity(token: number) {
    if (!this.capacityService || !this.environment) {
      return undefined;
    }
    try {
      const model = await this.capacityService.getNodeCapacity(this.environment);
      if (!this.isTokenCurrent(token)) {
        return undefined;
      }
      return model;
    } catch (error) {
      if (!this.isTokenCurrent(token)) {
        return undefined;
      }
      return {
        environmentLabel: this.environment.url,
        updatedAt: new Date().toISOString(),
        summary: {
          totalNodes: 0,
          onlineNodes: 0,
          offlineNodes: 0,
          totalExecutors: 0,
          busyExecutors: 0,
          idleExecutors: 0,
          offlineExecutors: 0,
          queuedCount: 0,
          stuckCount: 0,
          blockedCount: 0,
          buildableCount: 0,
          bottleneckCount: 0
        },
        pools: [],
        hiddenLabelQueueItems: [],
        errors: [formatActionError(error)],
        loading: false
      };
    }
  }

  private postMessage(message: NodeCapacityOutgoingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async openExternalUrl(url: string): Promise<void> {
    await openExternalHttpUrlWithWarning(url, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Node Capacity"
    });
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
    const token = this.loadToken;
    const environmentId = environment.environmentId;
    const uniqueNodeUrls = [...new Set(nodeUrls.filter((nodeUrl) => nodeUrl.trim().length > 0))];
    if (uniqueNodeUrls.length === 0) {
      return;
    }
    try {
      const entries = await capacityService.hydrateNodeExecutors(environment, uniqueNodeUrls);
      if (!this.isTokenCurrent(token) || this.environment?.environmentId !== environmentId) {
        return;
      }
      this.postMessage({ type: "updateNodeCapacityNodeExecutors", payload: entries });
    } catch (error) {
      if (!this.isTokenCurrent(token) || this.environment?.environmentId !== environmentId) {
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
    if (!this.environment || !this.hasRendered || !this.panel.visible) {
      return;
    }
    if (environmentId && this.environment.environmentId !== environmentId) {
      return;
    }
    await this.refreshCapacity({ skipLoading: true });
  }

  private startVisibleRefreshTimer(): void {
    if (!this.panel.visible || this.refreshTimer) {
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

  private beginLoading(): void {
    this.loadingRequests = beginLoadingRequest(this.loadingRequests, (value) =>
      this.postMessage({ type: "setLoading", value })
    );
  }

  private endLoading(): void {
    this.loadingRequests = endLoadingRequest(this.loadingRequests, (value) =>
      this.postMessage({ type: "setLoading", value })
    );
  }

  private isTokenCurrent(token: number): boolean {
    return token === this.loadToken;
  }

  private static configurePanel(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    configureWebviewPanel(panel, extensionUri, "server");
  }

  private renderRestoreError(message: string, panelState?: SerializedEnvironmentState): void {
    const nonce = createNonce();
    let styleUris: string[] = [];
    try {
      styleUris = resolveWebviewAssets(
        this.panel.webview,
        this.extensionUri,
        "nodeCapacity"
      ).styleUris;
    } catch {
      styleUris = [];
    }
    this.panel.webview.html = renderPanelRestoreErrorHtml(this.panel.webview.cspSource, {
      nonce,
      title: "Node Capacity",
      message,
      hint: "Open node capacity again from Jenkins Workbench to continue.",
      styleUris,
      panelState
    });
  }
}

function createPanelState(environment: JenkinsEnvironmentRef): SerializedEnvironmentState {
  return {
    environmentId: environment.environmentId,
    scope: environment.scope
  };
}

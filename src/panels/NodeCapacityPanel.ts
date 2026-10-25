import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { NodeCapacityService } from "../services/NodeCapacityService";
import type { NodeCapacityNodeExecutorsResult } from "../shared/nodeCapacity/NodeCapacityContracts";
import { buildNodeCapacityErrorViewModel } from "../shared/nodeCapacity/NodeCapacityDefaults";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { openJenkinsWorkbenchUrl } from "../ui/OpenExternalUrl";
import type { BuildDetailsPanelLauncher } from "./BuildDetailsPanelLauncher";
import { NodeCapacityPanelNavigation } from "./nodeCapacity/NodeCapacityPanelNavigation";
import {
  nodeCapacityWebviewEntryName,
  renderLoadingHtml,
  renderNodeCapacityHtml
} from "./nodeCapacity/NodeCapacityRenderer";
import {
  isLoadNodeCapacityExecutorsMessage,
  isOpenBuildDetailsMessage,
  isOpenExternalMessage,
  isOpenNodeDetailsMessage,
  isRefreshNodeCapacityMessage,
  type NodeCapacityOutgoingMessage
} from "./nodeCapacity/shared/NodeCapacityPanelMessages";
import type { EnvironmentPanelRefreshHost } from "./shared/PanelRuntimeHelpers";
import {
  attachPanelLifecycle,
  bindEnvironmentRefresh,
  closePanelForEnvironment,
  createPanelLoadingTracker,
  disposeEnvironmentScopedPanel,
  LoadTokenTracker,
  type PanelLoadTracker,
  shouldRefreshVisibleEnvironmentPanel
} from "./shared/PanelRuntimeHelpers";
import { resolvePanelAssetsAndRenderLoading } from "./shared/webview/PanelViewHelpers";
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
  /** Opens running builds in Build Details; without it they open in the browser. */
  buildDetailsPanelLauncher?: BuildDetailsPanelLauncher;
}

interface NodeCapacityPanelReviveOptions {
  dataService: JenkinsDataService;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
  refreshHost?: NodeCapacityRefreshHost;
  buildDetailsPanelLauncher?: BuildDetailsPanelLauncher;
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
  private buildDetailsPanelLauncher?: BuildDetailsPanelLauncher;
  private capacityService?: NodeCapacityService;
  private environment?: JenkinsEnvironmentRef;
  private readonly loadTokenTracker = new LoadTokenTracker();
  private readonly loadTracker: PanelLoadTracker;
  private readonly navigation: NodeCapacityPanelNavigation;
  private executorLoadGeneration = 0;
  private capacityRequestCount = 0;
  private hasRendered = false;
  private disposed = false;
  private nonce = createNonce();

  static async show(options: NodeCapacityPanelShowOptions): Promise<void> {
    const { dataService, environment, extensionUri, refreshHost, buildDetailsPanelLauncher } =
      options;

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
    activePanel.buildDetailsPanelLauncher = buildDetailsPanelLauncher;
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
    revived.buildDetailsPanelLauncher = options.buildDetailsPanelLauncher;
    revived.capacityService = new NodeCapacityService(options.dataService);
    revived.setRefreshHost(options.refreshHost);

    const restored = await resolveRestoredPanelEnvironment({
      panel: revived.panel,
      extensionUri: revived.extensionUri,
      entryName: nodeCapacityWebviewEntryName,
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

  /** Closes the panel when it shows the given environment, e.g. after its URL changed. */
  static closeForEnvironment(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const current = NodeCapacityPanel.currentPanel;
    closePanelForEnvironment(current?.panel, current?.environment, scope, environmentId);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.navigation = new NodeCapacityPanelNavigation(() => ({
      environment: this.environment,
      dataService: this.dataService,
      extensionUri: this.extensionUri,
      refreshHost: this.refreshHost,
      buildDetailsPanelLauncher: this.buildDetailsPanelLauncher
    }));
    this.loadTracker = createPanelLoadingTracker((message: NodeCapacityOutgoingMessage) =>
      this.postMessage(message)
    );
    this.attachLifecycle();
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
          void this.navigation.openNodeDetails(message.nodeUrl, message.label);
          return;
        }
        if (isOpenBuildDetailsMessage(message)) {
          void this.navigation.openBuildDetails(message.buildUrl, message.label);
          return;
        }
        if (isLoadNodeCapacityExecutorsMessage(message)) {
          void this.loadNodeExecutors(message.nodeUrls, message.requestId);
        }
      },
      null,
      this.disposables
    );
  }

  private attachLifecycle(): void {
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
  }

  private dispose(): void {
    this.disposed = true;
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
    this.executorLoadGeneration += 1;
    const token = this.loadTokenTracker.next();
    this.hasRendered = false;
    this.nonce = createNonce();
    this.loadTracker.resetLoadingRequests();
    try {
      const panelState = this.environment
        ? createSerializedEnvironmentState(this.environment)
        : undefined;

      const assets = resolvePanelAssetsAndRenderLoading({
        panel: this.panel,
        extensionUri: this.extensionUri,
        entryName: nodeCapacityWebviewEntryName,
        nonce: this.nonce,
        panelState,
        errorOptions: createMissingPanelAssetsMessages({
          title: "Node Capacity",
          panelLabel: "Node capacity"
        }),
        renderLoadingHtml
      });
      if (!assets) {
        return;
      }
      const { scriptUri, styleUris } = assets;

      const model = await this.fetchCapacity(token);
      if (!model || !this.loadTokenTracker.isCurrent(token)) {
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
    const token = this.loadTokenTracker.next();
    const loadingRequest = options?.skipLoading ? undefined : this.loadTracker.beginLoading();
    try {
      const model = await this.fetchCapacity(token);
      if (!model || !this.loadTokenTracker.isCurrent(token)) {
        return;
      }
      this.postMessage({ type: "updateNodeCapacity", payload: model });
    } finally {
      if (loadingRequest !== undefined) {
        this.loadTracker.endLoading(loadingRequest);
      }
      this.endCapacityRequest();
      if (!this.disposed) {
        this.startVisibleRefreshTimer();
      }
    }
  }

  private async fetchCapacity(token: number) {
    if (!this.capacityService || !this.environment) {
      return undefined;
    }
    try {
      const model = await this.capacityService.getNodeCapacity(this.environment);
      if (!this.loadTokenTracker.isCurrent(token)) {
        return undefined;
      }
      return model;
    } catch (error) {
      if (!this.loadTokenTracker.isCurrent(token)) {
        return undefined;
      }
      return buildNodeCapacityErrorViewModel(this.environment.url, [formatActionError(error)]);
    }
  }

  private postMessage(message: NodeCapacityOutgoingMessage): void {
    if (this.disposed) {
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private async openExternalUrl(url: string): Promise<void> {
    await openJenkinsWorkbenchUrl(url, "Node Capacity");
  }

  private async loadNodeExecutors(nodeUrls: string[], requestId: number): Promise<void> {
    if (!this.capacityService || !this.environment) {
      return;
    }
    const capacityService = this.capacityService;
    const environment = this.environment;
    const generation = this.executorLoadGeneration;
    const environmentId = environment.environmentId;
    const candidateNodeUrls = [...new Set(nodeUrls.filter((nodeUrl) => nodeUrl.trim().length > 0))];
    const uniqueNodeUrls = candidateNodeUrls.filter((nodeUrl) =>
      this.navigation.isUrlWithinEnvironment(nodeUrl)
    );
    if (uniqueNodeUrls.length < candidateNodeUrls.length) {
      console.warn("Node Capacity ignored executor requests for URLs outside the environment.");
    }
    if (uniqueNodeUrls.length === 0) {
      return;
    }
    // Per-node failures come back as inline error entries; the webview shows them
    // on the affected rows, so there is no toast that would repeat every poll.
    let payload: NodeCapacityNodeExecutorsResult[];
    try {
      payload = await capacityService.hydrateNodeExecutors(environment, uniqueNodeUrls);
    } catch (error) {
      const message = formatActionError(error);
      payload = uniqueNodeUrls.map((nodeUrl) => ({ nodeUrl, error: message }));
    }
    if (
      this.disposed ||
      this.executorLoadGeneration !== generation ||
      this.environment?.environmentId !== environmentId
    ) {
      return;
    }
    this.postMessage({ type: "updateNodeCapacityNodeExecutors", requestId, payload });
  }

  private setRefreshHost(refreshHost?: NodeCapacityRefreshHost): void {
    this.refreshHost = refreshHost;
    this.refreshSubscription = bindEnvironmentRefresh(
      this.refreshSubscription,
      refreshHost,
      this.handleEnvironmentRefresh.bind(this)
    );
  }

  private async handleEnvironmentRefresh(environmentId?: string): Promise<void> {
    if (
      !shouldRefreshVisibleEnvironmentPanel({
        environment: this.environment,
        environmentId,
        hasRendered: this.hasRendered,
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

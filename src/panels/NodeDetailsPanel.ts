import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsNodeDetails } from "../jenkins/types";
import { NodeActionService } from "../services/NodeActionService";
import { NodeQueuedWorkService } from "../services/NodeQueuedWorkService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { openJenkinsWorkbenchUrl } from "../ui/OpenExternalUrl";
import { renderLoadingHtml, renderNodeDetailsHtml } from "./nodeDetails/NodeDetailsRenderer";
import { buildNodeDetailsViewModel } from "./nodeDetails/NodeDetailsViewModel";
import {
  type NodeDetailsOutgoingMessage,
  isBringNodeOnlineMessage,
  isCopyNodeJsonMessage,
  isLaunchNodeAgentMessage,
  isLoadAdvancedNodeDetailsMessage,
  isOpenExternalMessage,
  isRefreshNodeDetailsMessage,
  isTakeNodeOfflineMessage
} from "./nodeDetails/shared/NodeDetailsPanelMessages";
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
  type SerializedEnvironmentState,
  createSerializedEnvironmentState,
  isSerializedEnvironmentState
} from "./shared/webview/WebviewPanelState";

interface NodeDetailsPanelSerializedState extends SerializedEnvironmentState {
  nodeUrl: string;
}

type NodeDetailsRefreshHost = EnvironmentPanelRefreshHost;

interface NodeDetailsPanelShowOptions {
  dataService: JenkinsDataService;
  environment: JenkinsEnvironmentRef;
  nodeUrl: string;
  extensionUri: vscode.Uri;
  label?: string;
  refreshHost?: NodeDetailsRefreshHost;
}

interface NodeDetailsPanelReviveOptions {
  dataService: JenkinsDataService;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
  refreshHost?: NodeDetailsRefreshHost;
}

function isNodeDetailsPanelState(value: unknown): value is NodeDetailsPanelSerializedState {
  if (!isSerializedEnvironmentState(value)) {
    return false;
  }
  const record = value as { nodeUrl?: unknown };
  return typeof record.nodeUrl === "string" && record.nodeUrl.length > 0;
}

function createNodeDetailsPanelState(
  environment: JenkinsEnvironmentRef,
  nodeUrl: string
): NodeDetailsPanelSerializedState {
  return {
    ...createSerializedEnvironmentState(environment),
    nodeUrl
  };
}

export class NodeDetailsPanel {
  private static currentPanel: NodeDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshSubscription?: vscode.Disposable;
  private refreshHost?: NodeDetailsRefreshHost;
  private dataService?: JenkinsDataService;
  private nodeActionService?: NodeActionService;
  private nodeQueuedWorkService?: NodeQueuedWorkService;
  private environment?: JenkinsEnvironmentRef;
  private nodeUrl?: string;
  private lastDetails?: JenkinsNodeDetails;
  private readonly loadTracker: PanelLoadTracker;
  private hasRendered = false;
  private nonce = createNonce();
  private advancedLoaded = false;

  static async show(options: NodeDetailsPanelShowOptions): Promise<void> {
    const { dataService, environment, nodeUrl, extensionUri, label, refreshHost } = options;

    if (!NodeDetailsPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.nodeDetails",
        "Node Details",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getWebviewAssetsRoot(extensionUri)]
        }
      );
      configureWebviewPanel(panel, extensionUri, "server");
      NodeDetailsPanel.currentPanel = new NodeDetailsPanel(panel, extensionUri);
    }

    const activePanel = NodeDetailsPanel.currentPanel;
    activePanel.dataService = dataService;
    activePanel.nodeActionService = new NodeActionService(dataService);
    activePanel.nodeQueuedWorkService = new NodeQueuedWorkService(dataService);
    activePanel.environment = environment;
    activePanel.nodeUrl = nodeUrl;
    activePanel.setRefreshHost(refreshHost);
    activePanel.panel.title = label ? `Node Details: ${label}` : "Node Details";
    activePanel.panel.reveal(undefined, true);
    await activePanel.load();
  }

  static async revive(
    panel: vscode.WebviewPanel,
    state: unknown,
    options: NodeDetailsPanelReviveOptions
  ): Promise<void> {
    configureWebviewPanel(panel, options.extensionUri, "server");
    panel.title = "Node Details";

    const revived = new NodeDetailsPanel(panel, options.extensionUri);
    NodeDetailsPanel.currentPanel = revived;
    revived.dataService = options.dataService;
    revived.nodeActionService = new NodeActionService(options.dataService);
    revived.nodeQueuedWorkService = new NodeQueuedWorkService(options.dataService);
    revived.setRefreshHost(options.refreshHost);

    const restored = await resolveRestoredPanelEnvironment({
      panel: revived.panel,
      extensionUri: revived.extensionUri,
      entryName: "nodeDetails",
      state,
      isValidState: isNodeDetailsPanelState,
      environmentStore: options.environmentStore,
      messages: createPanelRestoreMessages({
        title: "Node Details",
        viewNoun: "node details view",
        reopenHint: "Open the node again from Jenkins Workbench to continue."
      })
    });
    if (!restored.ok) {
      return;
    }

    revived.environment = restored.environment;
    revived.nodeUrl = restored.state.nodeUrl;
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
        void this.handlePanelVisible();
      }
    });
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (isRefreshNodeDetailsMessage(message)) {
          void this.refreshDetails();
          return;
        }
        if (isLoadAdvancedNodeDetailsMessage(message)) {
          void this.loadAdvancedDetails();
          return;
        }
        if (isTakeNodeOfflineMessage(message)) {
          void this.handleNodeAction("takeNodeOffline");
          return;
        }
        if (isBringNodeOnlineMessage(message)) {
          void this.handleNodeAction("bringNodeOnline");
          return;
        }
        if (isLaunchNodeAgentMessage(message)) {
          void this.handleNodeAction("launchNodeAgent");
          return;
        }
        if (isOpenExternalMessage(message)) {
          void this.openExternalUrl(message.url);
          return;
        }
        if (isCopyNodeJsonMessage(message)) {
          void this.copyJson(message.content);
        }
      },
      null,
      this.disposables
    );
  }

  private dispose(): void {
    disposeEnvironmentScopedPanel({
      clearSingleton: () => {
        NodeDetailsPanel.currentPanel = undefined;
      },
      onDispose: () => {
        this.refreshSubscription = undefined;
      },
      refreshSubscription: this.refreshSubscription,
      disposables: this.disposables
    });
  }

  private async load(): Promise<void> {
    const token = this.loadTracker.nextToken();
    this.hasRendered = false;
    this.nonce = createNonce();
    this.lastDetails = undefined;
    this.advancedLoaded = false;
    this.loadTracker.resetLoadingRequests();
    const panelState =
      this.environment && this.nodeUrl
        ? createNodeDetailsPanelState(this.environment, this.nodeUrl)
        : undefined;

    const assets = resolvePanelWebviewAssetsOrError(this.panel, this.extensionUri, "nodeDetails", {
      ...createMissingPanelAssetsMessages({
        title: "Node Details",
        panelLabel: "Node details",
        reopenHint: "Open the node again from Jenkins Workbench to continue."
      }),
      panelState
    });
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

    const model = await this.fetchNodeDetails(token, { mode: "refresh", detailLevel: "basic" });
    if (!model || !this.loadTracker.isCurrent(token)) {
      return;
    }

    this.panel.webview.html = renderNodeDetailsHtml(model, {
      cspSource: this.panel.webview.cspSource,
      nonce: this.nonce,
      scriptUri,
      styleUris,
      panelState
    });
    this.hasRendered = true;
  }

  private async refreshDetails(): Promise<void> {
    if (!this.hasRendered) {
      await this.load();
      return;
    }
    await this.refreshDetailsWith(this.currentDetailLevel);
  }

  private async loadAdvancedDetails(): Promise<void> {
    if (this.advancedLoaded) {
      return;
    }
    await this.refreshDetailsWith("advanced");
  }

  private async refreshDetailsWith(
    detailLevel: "basic" | "advanced",
    options?: { skipLoading?: boolean }
  ): Promise<void> {
    const token = this.loadTracker.nextToken();
    const shouldToggleLoading = !options?.skipLoading;
    if (shouldToggleLoading) {
      this.loadTracker.beginLoading();
    }
    try {
      const model = await this.fetchNodeDetails(token, { mode: "refresh", detailLevel });
      if (!model || !this.loadTracker.isCurrent(token)) {
        return;
      }
      this.postMessage({ type: "updateNodeDetails", payload: model });
    } finally {
      if (shouldToggleLoading) {
        this.loadTracker.endLoading();
      }
    }
  }

  private async handleNodeAction(
    action: "takeNodeOffline" | "bringNodeOnline" | "launchNodeAgent"
  ): Promise<void> {
    if (!this.nodeActionService || !this.environment || !this.nodeUrl) {
      return;
    }
    const label = this.lastDetails?.displayName ?? this.lastDetails?.name ?? "node";
    const target = { environment: this.environment, nodeUrl: this.nodeUrl, label };
    this.loadTracker.beginLoading();
    try {
      const { nodeActionService, refreshHost } = this;
      const actions = {
        takeNodeOffline: () => nodeActionService.takeNodeOffline(target, refreshHost),
        bringNodeOnline: () => nodeActionService.bringNodeOnline(target, refreshHost),
        launchNodeAgent: () => nodeActionService.launchNodeAgent(target, refreshHost)
      };
      const didToggle = await actions[action]();
      if (didToggle) {
        await this.refreshDetailsWith(this.currentDetailLevel, { skipLoading: true });
      }
    } catch (error) {
      void vscode.window.showErrorMessage(formatActionError(error));
    } finally {
      this.loadTracker.endLoading();
    }
  }

  private async fetchNodeDetails(
    token: number,
    options?: { mode?: "refresh"; detailLevel?: "basic" | "advanced" }
  ): Promise<ReturnType<typeof buildNodeDetailsViewModel> | undefined> {
    if (!this.dataService || !this.environment || !this.nodeUrl) {
      return undefined;
    }
    try {
      const detailLevel = options?.detailLevel ?? this.currentDetailLevel;
      const details = await this.dataService.getNodeDetails(this.environment, this.nodeUrl, {
        mode: options?.mode,
        detailLevel
      });
      if (!this.loadTracker.isCurrent(token)) {
        return undefined;
      }
      if (detailLevel === "advanced") {
        this.advancedLoaded = true;
      }
      this.lastDetails = details;
      const errors: string[] = [];
      let queuedWork:
        | Awaited<ReturnType<NodeQueuedWorkService["getQueuedWorkForNode"]>>
        | undefined;
      if (this.nodeQueuedWorkService) {
        try {
          queuedWork = await this.nodeQueuedWorkService.getQueuedWorkForNode(
            this.environment,
            details
          );
        } catch (error) {
          errors.push(`Unable to load queued work: ${formatActionError(error)}`);
        }
      }
      if (!this.loadTracker.isCurrent(token)) {
        return undefined;
      }
      return buildNodeDetailsViewModel({
        details,
        errors,
        updatedAt: new Date().toISOString(),
        fallbackUrl: this.nodeUrl,
        advancedLoaded: this.advancedLoaded,
        queuedWork,
        nowMs: Date.now()
      });
    } catch (error) {
      if (!this.loadTracker.isCurrent(token)) {
        return undefined;
      }
      const message = formatActionError(error);
      return buildNodeDetailsViewModel({
        details: this.lastDetails,
        errors: [message],
        updatedAt: new Date().toISOString(),
        fallbackUrl: this.nodeUrl,
        advancedLoaded: this.advancedLoaded,
        nowMs: Date.now()
      });
    }
  }

  private postMessage(message: NodeDetailsOutgoingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async openExternalUrl(url: string): Promise<void> {
    await openJenkinsWorkbenchUrl(url, "Node Details");
  }

  private async copyJson(content: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(content);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to copy node details: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private get currentDetailLevel(): "basic" | "advanced" {
    return this.advancedLoaded ? "advanced" : "basic";
  }

  private setRefreshHost(refreshHost?: NodeDetailsRefreshHost): void {
    this.refreshHost = refreshHost;
    this.refreshSubscription = bindEnvironmentRefresh(
      this.refreshSubscription,
      refreshHost,
      (environmentId) => this.handleEnvironmentRefresh(environmentId)
    );
  }

  private async handleEnvironmentRefresh(environmentId?: string): Promise<void> {
    if (
      !this.nodeUrl ||
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
    await this.refreshDetailsWith(this.currentDetailLevel, { skipLoading: true });
  }

  private async handlePanelVisible(): Promise<void> {
    if (!this.environment || !this.nodeUrl) {
      return;
    }
    if (!this.hasRendered) {
      await this.load();
      return;
    }
    await this.refreshDetailsWith(this.currentDetailLevel);
  }
}

import * as vscode from "vscode";
import type {
  EnvironmentScopedRefreshHost,
  ExtensionRefreshHost
} from "../extension/ExtensionRefreshHost";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsNodeDetails } from "../jenkins/types";
import { NodeActionService } from "../services/NodeActionService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { openExternalHttpUrlWithWarning } from "../ui/OpenExternalUrl";
import {
  type NodeDetailsOutgoingMessage,
  isBringNodeOnlineMessage,
  isCopyNodeJsonMessage,
  isLaunchNodeAgentMessage,
  isLoadAdvancedNodeDetailsMessage,
  isOpenExternalMessage,
  isRefreshNodeDetailsMessage,
  isTakeNodeOfflineMessage
} from "./nodeDetails/NodeDetailsMessages";
import { renderLoadingHtml, renderNodeDetailsHtml } from "./nodeDetails/NodeDetailsRenderer";
import { buildNodeDetailsViewModel } from "./nodeDetails/NodeDetailsViewModel";
import { getWebviewAssetsRoot, resolveWebviewAssets } from "./shared/webview/WebviewAssets";
import { renderPanelRestoreErrorHtml } from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import {
  type SerializedEnvironmentState,
  isSerializedEnvironmentState,
  resolveEnvironmentRef
} from "./shared/webview/WebviewPanelState";

interface NodeDetailsPanelSerializedState extends SerializedEnvironmentState {
  nodeUrl: string;
}

type NodeDetailsRefreshHost = EnvironmentScopedRefreshHost &
  Pick<ExtensionRefreshHost, "onDidRefreshEnvironment">;

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
    environmentId: environment.environmentId,
    scope: environment.scope,
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
  private environment?: JenkinsEnvironmentRef;
  private nodeUrl?: string;
  private lastDetails?: JenkinsNodeDetails;
  private loadToken = 0;
  private hasRendered = false;
  private nonce = createNonce();
  private advancedLoaded = false;
  private loadingRequests = 0;

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
      NodeDetailsPanel.configurePanel(panel, extensionUri);
      NodeDetailsPanel.currentPanel = new NodeDetailsPanel(panel, extensionUri);
    }

    const activePanel = NodeDetailsPanel.currentPanel;
    activePanel.dataService = dataService;
    activePanel.nodeActionService = new NodeActionService(dataService);
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
    NodeDetailsPanel.configurePanel(panel, options.extensionUri);
    panel.title = "Node Details";

    const revived = new NodeDetailsPanel(panel, options.extensionUri);
    NodeDetailsPanel.currentPanel = revived;
    revived.dataService = options.dataService;
    revived.nodeActionService = new NodeActionService(options.dataService);
    revived.setRefreshHost(options.refreshHost);

    if (!isNodeDetailsPanelState(state)) {
      revived.renderRestoreError(
        "This node details view could not be restored. Reopen it from Jenkins Workbench."
      );
      return;
    }

    const environment = await resolveEnvironmentRef(options.environmentStore, state);
    if (!environment) {
      revived.renderRestoreError(
        "This node details view could not be restored because its Jenkins environment was removed.",
        state
      );
      return;
    }

    revived.environment = environment;
    revived.nodeUrl = state.nodeUrl;
    await revived.load();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) {
          void this.handlePanelVisible();
        }
      },
      null,
      this.disposables
    );
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
    NodeDetailsPanel.currentPanel = undefined;
    if (this.refreshSubscription) {
      this.refreshSubscription.dispose();
      this.refreshSubscription = undefined;
    }
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.hasRendered = false;
    this.nonce = createNonce();
    this.lastDetails = undefined;
    this.advancedLoaded = false;
    this.loadingRequests = 0;
    const panelState =
      this.environment && this.nodeUrl
        ? createNodeDetailsPanelState(this.environment, this.nodeUrl)
        : undefined;

    let scriptUri: string;
    let styleUris: string[];
    try {
      ({ scriptUri, styleUris } = resolveWebviewAssets(
        this.panel.webview,
        this.extensionUri,
        "nodeDetails"
      ));
    } catch {
      this.renderRestoreError(
        "Node details webview assets are missing. Run the extension build (npm run compile) and try again.",
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

    const model = await this.fetchNodeDetails(token, { mode: "refresh", detailLevel: "basic" });
    if (!model || !this.isTokenCurrent(token)) {
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
    const token = ++this.loadToken;
    const shouldToggleLoading = !options?.skipLoading;
    if (shouldToggleLoading) {
      this.beginLoading();
    }
    try {
      const model = await this.fetchNodeDetails(token, { mode: "refresh", detailLevel });
      if (!model || !this.isTokenCurrent(token)) {
        return;
      }
      this.postMessage({ type: "updateNodeDetails", payload: model });
    } finally {
      if (shouldToggleLoading) {
        this.endLoading();
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
    this.beginLoading();
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
      this.endLoading();
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
      if (!this.isTokenCurrent(token)) {
        return undefined;
      }
      if (detailLevel === "advanced") {
        this.advancedLoaded = true;
      }
      this.lastDetails = details;
      return buildNodeDetailsViewModel({
        details,
        errors: [],
        updatedAt: new Date().toISOString(),
        fallbackUrl: this.nodeUrl,
        advancedLoaded: this.advancedLoaded,
        nowMs: Date.now()
      });
    } catch (error) {
      if (!this.isTokenCurrent(token)) {
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
    await openExternalHttpUrlWithWarning(url, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Node Details"
    });
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

  private isTokenCurrent(token: number): boolean {
    return token === this.loadToken;
  }

  private setRefreshHost(refreshHost?: NodeDetailsRefreshHost): void {
    this.refreshHost = refreshHost;
    if (this.refreshSubscription) {
      this.refreshSubscription.dispose();
      this.refreshSubscription = undefined;
    }
    if (!refreshHost?.onDidRefreshEnvironment) {
      return;
    }
    this.refreshSubscription = refreshHost.onDidRefreshEnvironment((environmentId) => {
      void this.handleEnvironmentRefresh(environmentId);
    });
  }

  private async handleEnvironmentRefresh(environmentId?: string): Promise<void> {
    if (!this.environment || !this.nodeUrl || !this.hasRendered) {
      return;
    }
    if (environmentId && this.environment.environmentId !== environmentId) {
      return;
    }
    if (!this.panel.visible) {
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

  private beginLoading(): void {
    this.loadingRequests += 1;
    if (this.loadingRequests === 1) {
      this.postMessage({ type: "setLoading", value: true });
    }
  }

  private endLoading(): void {
    if (this.loadingRequests === 0) {
      return;
    }
    this.loadingRequests -= 1;
    if (this.loadingRequests === 0) {
      this.postMessage({ type: "setLoading", value: false });
    }
  }

  private static configurePanel(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewAssetsRoot(extensionUri)]
    };
    panel.iconPath = NodeDetailsPanel.getIconPaths(extensionUri);
  }

  private static getIconPaths(extensionUri: vscode.Uri): { light: vscode.Uri; dark: vscode.Uri } {
    const lightIconPath = vscode.Uri.joinPath(
      extensionUri,
      "resources",
      "codicons",
      "server-light.svg"
    );
    const darkIconPath = vscode.Uri.joinPath(
      extensionUri,
      "resources",
      "codicons",
      "server-dark.svg"
    );
    return { light: lightIconPath, dark: darkIconPath };
  }

  private renderRestoreError(message: string, panelState?: NodeDetailsPanelSerializedState): void {
    const nonce = createNonce();
    let styleUris: string[] = [];
    try {
      styleUris = resolveWebviewAssets(this.panel.webview, this.extensionUri, "nodeDetails")
        .styleUris;
    } catch {
      styleUris = [];
    }
    this.panel.webview.html = renderPanelRestoreErrorHtml(this.panel.webview.cspSource, {
      nonce,
      title: "Node Details",
      message,
      hint: "Open the node again from Jenkins Workbench to continue.",
      styleUris,
      panelState
    });
  }
}

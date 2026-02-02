import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsNodeDetails } from "../jenkins/types";
import {
  type NodeDetailsOutgoingMessage,
  isCopyNodeJsonMessage,
  isBringNodeOnlineMessage,
  isLaunchNodeAgentMessage,
  isLoadAdvancedNodeDetailsMessage,
  isOpenExternalMessage,
  isRefreshNodeDetailsMessage,
  isTakeNodeOfflineMessage
} from "./nodeDetails/NodeDetailsMessages";
import { renderLoadingHtml, renderNodeDetailsHtml } from "./nodeDetails/NodeDetailsRenderer";
import { buildNodeDetailsViewModel } from "./nodeDetails/NodeDetailsViewModel";
import {
  NODE_DETAILS_WEBVIEW_BUNDLE_PATH,
  NODE_DETAILS_WEBVIEW_CSS_PATH
} from "./nodeDetails/NodeDetailsWebviewAssets";
import {
  renderWebviewShell,
  renderWebviewStateScript
} from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import {
  isSerializedEnvironmentState,
  resolveEnvironmentRef,
  type SerializedEnvironmentState
} from "./shared/webview/WebviewPanelState";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { ExtensionRefreshHost } from "../extension/ExtensionRefreshHost";
import { NodeActionService } from "../services/NodeActionService";

interface NodeDetailsPanelSerializedState extends SerializedEnvironmentState {
  nodeUrl: string;
}

interface NodeDetailsPanelReviveOptions {
  dataService: JenkinsDataService;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
  refreshHost?: ExtensionRefreshHost;
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
  private refreshHost?: ExtensionRefreshHost;
  private dataService?: JenkinsDataService;
  private nodeActionService?: NodeActionService;
  private environment?: JenkinsEnvironmentRef;
  private nodeUrl?: string;
  private lastDetails?: JenkinsNodeDetails;
  private loadToken = 0;
  private hasRendered = false;
  private nonce = createNonce();
  private advancedLoaded = false;

  static async show(
    dataService: JenkinsDataService,
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    extensionUri: vscode.Uri,
    label?: string,
    refreshHost?: ExtensionRefreshHost
  ): Promise<void> {
    if (!NodeDetailsPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.nodeDetails",
        "Node Details",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [NodeDetailsPanel.getWebviewRoot(extensionUri)]
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
    const panelState =
      this.environment && this.nodeUrl
        ? createNodeDetailsPanelState(this.environment, this.nodeUrl)
        : undefined;

    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...NODE_DETAILS_WEBVIEW_CSS_PATH.split("/"))
    );
    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: this.nonce,
      styleUri: styleUri.toString(),
      panelState
    });

    const model = await this.fetchNodeDetails(token, { mode: "refresh", detailLevel: "basic" });
    if (!model || !this.isTokenCurrent(token)) {
      return;
    }

    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...NODE_DETAILS_WEBVIEW_BUNDLE_PATH.split("/"))
    );

    this.panel.webview.html = renderNodeDetailsHtml(model, {
      cspSource: this.panel.webview.cspSource,
      nonce: this.nonce,
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString(),
      panelState
    });
    this.hasRendered = true;
  }

  private async refreshDetails(): Promise<void> {
    if (!this.hasRendered) {
      await this.load();
      return;
    }
    const detailLevel = this.advancedLoaded ? "advanced" : "basic";
    await this.refreshDetailsWith(detailLevel);
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
      this.postMessage({ type: "setLoading", value: true });
    }
    try {
      const model = await this.fetchNodeDetails(token, { mode: "refresh", detailLevel });
      if (!model || !this.isTokenCurrent(token)) {
        return;
      }
      this.postMessage({ type: "updateNodeDetails", payload: model });
    } finally {
      if (shouldToggleLoading && this.isTokenCurrent(token)) {
        this.postMessage({ type: "setLoading", value: false });
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
    const refreshHost = this.refreshHost
      ? {
          refreshEnvironment: (environmentId: string) => {
            this.refreshHost?.refreshEnvironment(environmentId);
          }
        }
      : undefined;
    this.postMessage({ type: "setLoading", value: true });
    try {
      let didToggle = false;
      if (action === "takeNodeOffline") {
        didToggle = await this.nodeActionService.takeNodeOffline(target, refreshHost);
      } else if (action === "bringNodeOnline") {
        didToggle = await this.nodeActionService.bringNodeOnline(target, refreshHost);
      } else {
        didToggle = await this.nodeActionService.launchNodeAgent(target, refreshHost);
      }
      if (didToggle) {
        await this.refreshDetailsWith(this.advancedLoaded ? "advanced" : "basic", {
          skipLoading: true
        });
      }
    } catch (error) {
      void vscode.window.showErrorMessage(formatActionError(error));
    } finally {
      this.postMessage({ type: "setLoading", value: false });
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
      const detailLevel = options?.detailLevel ?? (this.advancedLoaded ? "advanced" : "basic");
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
    let parsed: vscode.Uri;
    try {
      parsed = vscode.Uri.parse(url);
    } catch {
      return;
    }
    if (parsed.scheme !== "http" && parsed.scheme !== "https") {
      return;
    }
    await vscode.env.openExternal(parsed);
  }

  private async copyJson(content: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(content);
      void vscode.window.showInformationMessage("Node details JSON copied to clipboard.");
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to copy node details: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private isTokenCurrent(token: number): boolean {
    return token === this.loadToken;
  }

  private setRefreshHost(refreshHost?: ExtensionRefreshHost): void {
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
    await this.refreshDetailsWith(this.advancedLoaded ? "advanced" : "basic", {
      skipLoading: true
    });
  }

  private async handlePanelVisible(): Promise<void> {
    if (!this.environment || !this.nodeUrl) {
      return;
    }
    if (!this.hasRendered) {
      await this.load();
      return;
    }
    await this.refreshDetailsWith(this.advancedLoaded ? "advanced" : "basic", {
      skipLoading: true
    });
  }

  private static configurePanel(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [NodeDetailsPanel.getWebviewRoot(extensionUri)]
    };
    panel.iconPath = NodeDetailsPanel.getIconPaths(extensionUri);
  }

  private static getWebviewRoot(extensionUri: vscode.Uri): vscode.Uri {
    const bundleSegments = NODE_DETAILS_WEBVIEW_BUNDLE_PATH.split("/");
    const bundleRootSegments = bundleSegments.slice(0, -1);
    return vscode.Uri.joinPath(extensionUri, ...bundleRootSegments);
  }

  private static getIconPaths(
    extensionUri: vscode.Uri
  ): { light: vscode.Uri; dark: vscode.Uri } {
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
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...NODE_DETAILS_WEBVIEW_CSS_PATH.split("/"))
    );
    const stateScript = renderWebviewStateScript(panelState, nonce);
    this.panel.webview.html = renderWebviewShell(
      `
        ${stateScript}
        <main class="jenkins-workbench-panel-message">
          <h1>Node Details</h1>
          <p>${message}</p>
          <p>Open the node again from Jenkins Workbench to continue.</p>
        </main>
        <style nonce="${nonce}">
          .jenkins-workbench-panel-message {
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            line-height: 1.5;
            margin: 32px;
          }
          .jenkins-workbench-panel-message h1 {
            font-size: 20px;
            margin: 0 0 12px;
          }
          .jenkins-workbench-panel-message p {
            margin: 0 0 8px;
          }
        </style>
      `,
      {
        cspSource: this.panel.webview.cspSource,
        nonce,
        styleUri: styleUri.toString()
      }
    );
  }
}

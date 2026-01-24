import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsNodeDetails } from "../jenkins/types";
import { formatActionError } from "../formatters/ErrorFormatters";
import { createNonce } from "./shared/webview/WebviewNonce";
import {
  isCopyNodeJsonMessage,
  isLoadAdvancedNodeDetailsMessage,
  isOpenExternalMessage,
  isRefreshNodeDetailsMessage,
  type NodeDetailsOutgoingMessage
} from "./nodeDetails/NodeDetailsMessages";
import { renderLoadingHtml, renderNodeDetailsHtml } from "./nodeDetails/NodeDetailsRenderer";
import { buildNodeDetailsViewModel } from "./nodeDetails/NodeDetailsViewModel";
import {
  NODE_DETAILS_WEBVIEW_BUNDLE_PATH,
  NODE_DETAILS_WEBVIEW_CSS_PATH
} from "./nodeDetails/NodeDetailsWebviewAssets";

export class NodeDetailsPanel {
  private static currentPanel: NodeDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private dataService?: JenkinsDataService;
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
    label?: string
  ): Promise<void> {
    const bundleSegments = NODE_DETAILS_WEBVIEW_BUNDLE_PATH.split("/");
    const bundleRootSegments = bundleSegments.slice(0, -1);
    if (!NodeDetailsPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.nodeDetails",
        "Node Details",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, ...bundleRootSegments)]
        }
      );
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
      panel.iconPath = { light: lightIconPath, dark: darkIconPath };
      NodeDetailsPanel.currentPanel = new NodeDetailsPanel(panel, extensionUri);
    }

    const activePanel = NodeDetailsPanel.currentPanel;
    activePanel.dataService = dataService;
    activePanel.environment = environment;
    activePanel.nodeUrl = nodeUrl;
    activePanel.panel.title = label ? `Node Details: ${label}` : "Node Details";
    activePanel.panel.reveal(undefined, true);
    await activePanel.load();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
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

    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...NODE_DETAILS_WEBVIEW_CSS_PATH.split("/"))
    );
    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: this.nonce,
      styleUri: styleUri.toString()
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
      styleUri: styleUri.toString()
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

  private async refreshDetailsWith(detailLevel: "basic" | "advanced"): Promise<void> {
    const token = this.loadToken;
    this.postMessage({ type: "setLoading", value: true });
    const model = await this.fetchNodeDetails(token, { mode: "refresh", detailLevel });
    if (!model || !this.isTokenCurrent(token)) {
      return;
    }
    this.postMessage({ type: "updateNodeDetails", payload: model });
    this.postMessage({ type: "setLoading", value: false });
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
      const details = await this.dataService.getNodeDetails(
        this.environment,
        this.nodeUrl,
        {
          mode: options?.mode,
          detailLevel
        }
      );
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
        advancedLoaded: this.advancedLoaded
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
        advancedLoaded: this.advancedLoaded
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
}

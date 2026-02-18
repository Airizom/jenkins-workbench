import type * as vscode from "vscode";
import { resolveWebviewAssets } from "../shared/webview/WebviewAssets";
import type { BuildDetailsOutgoingMessage } from "./BuildDetailsMessages";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import { renderBuildDetailsHtml, renderLoadingHtml } from "./BuildDetailsRenderer";
import { buildUpdateMessageFromState } from "./BuildDetailsUpdateBuilder";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export interface BuildDetailsPanelViewAssets {
  scriptUri: string;
  styleUris: string[];
}

export interface BuildDetailsPanelRenderOptions {
  nonce: string;
  panelState?: unknown;
}

export class BuildDetailsPanelView {
  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveAssets(): BuildDetailsPanelViewAssets | undefined {
    try {
      return resolveWebviewAssets(this.panel.webview, this.extensionUri, "buildDetails");
    } catch {
      return undefined;
    }
  }

  renderLoading(options: BuildDetailsPanelRenderOptions & { styleUris: string[] }): void {
    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: options.nonce,
      styleUris: options.styleUris,
      panelState: options.panelState
    });
  }

  renderBuildDetails(
    model: BuildDetailsViewModel,
    assets: BuildDetailsPanelViewAssets,
    options: BuildDetailsPanelRenderOptions
  ): void {
    this.panel.webview.html = renderBuildDetailsHtml(model, {
      cspSource: this.panel.webview.cspSource,
      nonce: options.nonce,
      scriptUri: assets.scriptUri,
      styleUris: assets.styleUris,
      panelState: options.panelState
    });
  }

  setTitle(label?: string): void {
    this.panel.title = label ? `Build Details - ${label}` : "Build Details";
  }

  isVisible(): boolean {
    return this.panel.visible;
  }

  postMessage(message: BuildDetailsOutgoingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  postStateUpdate(state: BuildDetailsPanelState): void {
    const updateMessage = buildUpdateMessageFromState(state);
    if (updateMessage) {
      this.postMessage(updateMessage);
    }
  }

  postErrors(errors: string[]): void {
    this.postMessage({ type: "setErrors", errors });
  }

  setLoading(value: boolean): void {
    this.postMessage({ type: "setLoading", value });
  }

  postConsoleSnapshot(snapshot: {
    consoleTextResult?: { text: string; truncated: boolean };
    consoleHtmlResult?: { html: string; truncated: boolean };
  }): void {
    if (snapshot.consoleHtmlResult) {
      this.postMessage({
        type: "setConsoleHtml",
        html: snapshot.consoleHtmlResult.html,
        truncated: snapshot.consoleHtmlResult.truncated
      });
      return;
    }
    if (!snapshot.consoleTextResult) {
      return;
    }
    this.postMessage({
      type: "setConsole",
      text: snapshot.consoleTextResult.text,
      truncated: snapshot.consoleTextResult.truncated
    });
  }
}

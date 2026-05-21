import type * as vscode from "vscode";
import { assignPanelLoadingHtml, resolvePanelViewAssets } from "../shared/webview/PanelViewHelpers";
import type { BuildDetailsOutgoingMessage } from "./BuildDetailsMessages";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import { renderBuildDetailsHtml } from "./BuildDetailsRenderer";
import { buildUpdateMessageFromState } from "./BuildDetailsUpdateBuilder";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export type { PanelViewAssets as BuildDetailsPanelViewAssets } from "../shared/webview/PanelViewHelpers";

export interface BuildDetailsPanelRenderOptions {
  nonce: string;
  panelState?: unknown;
}

export class BuildDetailsPanelView {
  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveAssets() {
    return resolvePanelViewAssets(this.panel.webview, this.extensionUri, "buildDetails");
  }

  renderLoading(options: BuildDetailsPanelRenderOptions & { styleUris: string[] }): void {
    assignPanelLoadingHtml(this.panel, "build", options);
  }

  renderBuildDetails(
    model: BuildDetailsViewModel,
    assets: NonNullable<ReturnType<BuildDetailsPanelView["resolveAssets"]>>,
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

  postStateUpdate(
    state: BuildDetailsPanelState,
    options?: { canOpenSource?: (className?: string) => boolean; coverageEnabled?: boolean }
  ): void {
    const updateMessage = buildUpdateMessageFromState(state, options);
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

import type * as vscode from "vscode";
import { resolveWebviewAssets } from "../shared/webview/WebviewAssets";
import { renderPanelRestoreErrorHtml } from "../shared/webview/WebviewHtml";
import { renderBuildCompareHtml, renderLoadingHtml } from "./BuildCompareRenderer";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export interface BuildComparePanelViewAssets {
  scriptUri: string;
  styleUris: string[];
}

export interface BuildComparePanelRenderOptions {
  nonce: string;
  panelState?: unknown;
}

export class BuildComparePanelView {
  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveAssets(): BuildComparePanelViewAssets | undefined {
    try {
      return resolveWebviewAssets(this.panel.webview, this.extensionUri, "buildCompare");
    } catch {
      return undefined;
    }
  }

  renderLoading(options: BuildComparePanelRenderOptions & { styleUris: string[] }): void {
    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: options.nonce,
      styleUris: options.styleUris,
      panelState: options.panelState
    });
  }

  renderBuildCompare(
    model: BuildCompareViewModel,
    assets: BuildComparePanelViewAssets,
    options: BuildComparePanelRenderOptions
  ): void {
    this.panel.webview.html = renderBuildCompareHtml(model, {
      cspSource: this.panel.webview.cspSource,
      nonce: options.nonce,
      scriptUri: assets.scriptUri,
      styleUris: assets.styleUris,
      panelState: options.panelState
    });
  }

  postMessage(message: unknown): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  renderError(message: string, options: BuildComparePanelRenderOptions): void {
    const styleUris = this.resolveAssets()?.styleUris ?? [];
    this.panel.webview.html = renderPanelRestoreErrorHtml(this.panel.webview.cspSource, {
      nonce: options.nonce,
      title: "Build Compare",
      message,
      hint: "Choose another build pair or reopen the comparison from Jenkins Workbench.",
      styleUris,
      panelState: options.panelState
    });
  }

  setTitle(label?: string): void {
    this.panel.title = label ? `Build Compare - ${label}` : "Build Compare";
  }
}

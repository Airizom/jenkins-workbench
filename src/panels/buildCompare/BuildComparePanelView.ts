import type * as vscode from "vscode";
import {
  type EnvironmentPanelRenderOptions,
  EnvironmentPanelView
} from "../shared/webview/PanelViewHelpers";
import { renderPanelRestoreErrorHtml } from "../shared/webview/WebviewHtml";
import { renderBuildCompareHtml } from "./BuildCompareRenderer";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export type BuildComparePanelRenderOptions = EnvironmentPanelRenderOptions;

export class BuildComparePanelView extends EnvironmentPanelView<BuildCompareViewModel> {
  constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    super(panel, extensionUri, "buildCompare", "build", "Build Compare", renderBuildCompareHtml);
  }

  renderBuildCompare(
    model: BuildCompareViewModel,
    assets: NonNullable<ReturnType<BuildComparePanelView["resolveAssets"]>>,
    options: BuildComparePanelRenderOptions
  ): void {
    this.renderModel(model, assets, options);
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
}

import {
  type PanelDetailsRenderOptions,
  renderPanelAppHtml,
  renderPanelLoadingHtml
} from "../shared/webview/WebviewHtml";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export type BuildCompareRenderOptions = PanelDetailsRenderOptions;

export function renderLoadingHtml(options: BuildCompareRenderOptions): string {
  return renderPanelLoadingHtml(options, "build");
}

export function renderBuildCompareHtml(
  model: BuildCompareViewModel,
  options: BuildCompareRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

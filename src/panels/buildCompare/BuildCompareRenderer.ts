import { createPanelLoadingRenderer, renderPanelAppHtml } from "../shared/webview/WebviewHtml";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export type { PanelDetailsRenderOptions as BuildCompareRenderOptions } from "../shared/webview/WebviewHtml";

export const renderLoadingHtml = createPanelLoadingRenderer("build");

export function renderBuildCompareHtml(
  model: BuildCompareViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

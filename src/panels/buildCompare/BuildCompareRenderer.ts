import { createPanelAppRenderer } from "../shared/webview/WebviewHtml";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export type { PanelDetailsRenderOptions as BuildCompareRenderOptions } from "../shared/webview/WebviewHtml";

const { renderLoadingHtml: renderBuildLoadingHtml, renderAppHtml } =
  createPanelAppRenderer("build");

export const renderLoadingHtml = renderBuildLoadingHtml;

export function renderBuildCompareHtml(
  model: BuildCompareViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderAppHtml(model, options);
}

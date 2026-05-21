import { createPanelAppRenderer } from "../shared/webview/WebviewHtml";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export type { PanelDetailsRenderOptions as BuildDetailsRenderOptions } from "../shared/webview/WebviewHtml";

const { renderLoadingHtml: renderBuildLoadingHtml, renderAppHtml } =
  createPanelAppRenderer("build");

export const renderLoadingHtml = renderBuildLoadingHtml;

export function renderBuildDetailsHtml(
  model: BuildDetailsViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderAppHtml(model, options);
}

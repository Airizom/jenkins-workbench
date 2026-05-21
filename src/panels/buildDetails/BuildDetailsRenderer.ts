import { createPanelLoadingRenderer, renderPanelAppHtml } from "../shared/webview/WebviewHtml";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export type { PanelDetailsRenderOptions as BuildDetailsRenderOptions } from "../shared/webview/WebviewHtml";

export const renderLoadingHtml = createPanelLoadingRenderer("build");

export function renderBuildDetailsHtml(
  model: BuildDetailsViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

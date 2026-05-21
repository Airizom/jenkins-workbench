import { createPanelLoadingRenderer, renderPanelAppHtml } from "../shared/webview/WebviewHtml";
import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

export type { PanelDetailsRenderOptions as NodeDetailsRenderOptions } from "../shared/webview/WebviewHtml";

export const renderLoadingHtml = createPanelLoadingRenderer("node");

export function renderNodeDetailsHtml(
  model: NodeDetailsViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

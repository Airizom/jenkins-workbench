import { createPanelAppRenderer } from "../shared/webview/WebviewHtml";
import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

export type { PanelDetailsRenderOptions as NodeDetailsRenderOptions } from "../shared/webview/WebviewHtml";

const { renderLoadingHtml: renderNodeLoadingHtml, renderAppHtml } = createPanelAppRenderer("node");

export const renderLoadingHtml = renderNodeLoadingHtml;

export function renderNodeDetailsHtml(
  model: NodeDetailsViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderAppHtml(model, options);
}

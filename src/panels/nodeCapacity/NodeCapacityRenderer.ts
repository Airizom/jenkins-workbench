import type { NodeCapacityViewModel } from "../../shared/nodeCapacity/NodeCapacityContracts";
import { createPanelAppRenderer } from "../shared/webview/WebviewHtml";

export type { PanelDetailsRenderOptions as NodeCapacityRenderOptions } from "../shared/webview/WebviewHtml";

const { renderLoadingHtml: renderNodeLoadingHtml, renderAppHtml } = createPanelAppRenderer("node");

export const renderLoadingHtml = renderNodeLoadingHtml;

export function renderNodeCapacityHtml(
  model: NodeCapacityViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderAppHtml(model, options);
}

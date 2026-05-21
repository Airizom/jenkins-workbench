import type { NodeCapacityViewModel } from "../../shared/nodeCapacity/NodeCapacityContracts";
import { createPanelLoadingRenderer, renderPanelAppHtml } from "../shared/webview/WebviewHtml";

export type { PanelDetailsRenderOptions as NodeCapacityRenderOptions } from "../shared/webview/WebviewHtml";

export const renderLoadingHtml = createPanelLoadingRenderer("node");

export function renderNodeCapacityHtml(
  model: NodeCapacityViewModel,
  options: import("../shared/webview/WebviewHtml").PanelDetailsRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

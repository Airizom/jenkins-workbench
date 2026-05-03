import type { NodeCapacityViewModel } from "../../shared/nodeCapacity/NodeCapacityContracts";
import {
  type PanelDetailsRenderOptions,
  renderPanelAppHtml,
  renderPanelLoadingHtml
} from "../shared/webview/WebviewHtml";

export type NodeCapacityRenderOptions = PanelDetailsRenderOptions;

export function renderLoadingHtml(options: NodeCapacityRenderOptions): string {
  return renderPanelLoadingHtml(options, "node");
}

export function renderNodeCapacityHtml(
  model: NodeCapacityViewModel,
  options: NodeCapacityRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

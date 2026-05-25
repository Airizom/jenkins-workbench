import type { NodeCapacityViewModel } from "../../shared/nodeCapacity/NodeCapacityContracts";
import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";

export type { PanelDetailsRenderOptions as NodeCapacityRenderOptions } from "../shared/webview/WebviewHtml";

export const { renderLoadingHtml, renderPanelHtml: renderNodeCapacityHtml } =
  createTypedPanelRenderer<NodeCapacityViewModel>("node");

import type { NodeCapacityViewModel } from "../../shared/nodeCapacity/NodeCapacityContracts";
import type { WebviewEntryName } from "../shared/webview/WebviewAssets";
import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";

export const nodeCapacityWebviewEntryName = "nodeCapacity" satisfies WebviewEntryName;

export const { renderLoadingHtml, renderPanelHtml: renderNodeCapacityHtml } =
  createTypedPanelRenderer<NodeCapacityViewModel>({
    entryName: nodeCapacityWebviewEntryName,
    skeletonVariant: "node"
  });

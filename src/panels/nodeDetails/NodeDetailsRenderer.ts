import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";
import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

export type { PanelDetailsRenderOptions as NodeDetailsRenderOptions } from "../shared/webview/WebviewHtml";

export const { renderLoadingHtml, renderPanelHtml: renderNodeDetailsHtml } =
  createTypedPanelRenderer<NodeDetailsViewModel>("node");

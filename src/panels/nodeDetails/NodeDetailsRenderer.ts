import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";
import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

export const { renderLoadingHtml, renderPanelHtml: renderNodeDetailsHtml } =
  createTypedPanelRenderer<NodeDetailsViewModel>("node");

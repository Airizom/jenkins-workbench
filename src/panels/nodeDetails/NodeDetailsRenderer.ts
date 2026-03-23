import {
  type PanelDetailsRenderOptions,
  renderPanelAppHtml,
  renderPanelLoadingHtml
} from "../shared/webview/WebviewHtml";
import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

export type NodeDetailsRenderOptions = PanelDetailsRenderOptions;

export function renderLoadingHtml(options: NodeDetailsRenderOptions): string {
  return renderPanelLoadingHtml(options, "node");
}

export function renderNodeDetailsHtml(
  model: NodeDetailsViewModel,
  options: NodeDetailsRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

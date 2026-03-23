import {
  type PanelDetailsRenderOptions,
  renderPanelAppHtml,
  renderPanelLoadingHtml
} from "../shared/webview/WebviewHtml";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export type BuildDetailsRenderOptions = PanelDetailsRenderOptions;

export function renderLoadingHtml(options: BuildDetailsRenderOptions): string {
  return renderPanelLoadingHtml(options, "build");
}

export function renderBuildDetailsHtml(
  model: BuildDetailsViewModel,
  options: BuildDetailsRenderOptions
): string {
  return renderPanelAppHtml(model, options);
}

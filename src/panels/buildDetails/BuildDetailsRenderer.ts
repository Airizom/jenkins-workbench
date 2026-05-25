import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export type { PanelDetailsRenderOptions as BuildDetailsRenderOptions } from "../shared/webview/WebviewHtml";

export const { renderLoadingHtml, renderPanelHtml: renderBuildDetailsHtml } =
  createTypedPanelRenderer<BuildDetailsViewModel>("build");

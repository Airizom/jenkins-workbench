import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export type { PanelDetailsRenderOptions as BuildCompareRenderOptions } from "../shared/webview/WebviewHtml";

export const { renderLoadingHtml, renderPanelHtml: renderBuildCompareHtml } =
  createTypedPanelRenderer<BuildCompareViewModel>("build");

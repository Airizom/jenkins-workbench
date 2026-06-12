import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export const { renderPanelHtml: renderBuildCompareHtml } =
  createTypedPanelRenderer<BuildCompareViewModel>("build");

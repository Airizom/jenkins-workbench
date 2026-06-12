import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export const { renderPanelHtml: renderBuildDetailsHtml } =
  createTypedPanelRenderer<BuildDetailsViewModel>("build");

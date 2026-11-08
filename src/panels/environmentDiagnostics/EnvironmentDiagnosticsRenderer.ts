import { createTypedPanelRenderer } from "../shared/webview/WebviewHtml";
import type { EnvironmentDiagnosticsViewModel } from "./shared/EnvironmentDiagnosticsPanelMessages";

export const { renderLoadingHtml, renderPanelHtml: renderEnvironmentDiagnosticsHtml } =
  createTypedPanelRenderer<EnvironmentDiagnosticsViewModel>("capacity");

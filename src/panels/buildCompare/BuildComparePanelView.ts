import type * as vscode from "vscode";
import { escapeHtml } from "../../shared/html";
import {
  type EnvironmentPanelRenderOptions,
  EnvironmentPanelView
} from "../shared/webview/PanelViewHelpers";
import { serializeForScript } from "../shared/webview/WebviewHtml";
import { renderBuildCompareHtml } from "./BuildCompareRenderer";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";
import type { RefreshBuildCompareMessage } from "./shared/BuildComparePanelMessages";

export type BuildComparePanelRenderOptions = EnvironmentPanelRenderOptions;

export class BuildComparePanelView extends EnvironmentPanelView<BuildCompareViewModel> {
  constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    super(panel, extensionUri, "buildCompare", "build", "Build Compare", renderBuildCompareHtml);
  }

  renderBuildCompare(
    model: BuildCompareViewModel,
    assets: NonNullable<ReturnType<BuildComparePanelView["resolveAssets"]>>,
    options: BuildComparePanelRenderOptions
  ): void {
    this.renderModel(model, assets, options);
  }

  postMessage(message: unknown): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  /** Initial-load failure page with a Retry button that re-runs the comparison. */
  renderError(message: string, options: BuildComparePanelRenderOptions): void {
    this.panel.webview.html = renderBuildCompareLoadErrorHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: options.nonce,
      message,
      panelState: options.panelState
    });
  }
}

export function renderBuildCompareLoadErrorHtml(options: {
  cspSource: string;
  nonce: string;
  message: string;
  panelState?: unknown;
}): string {
  const { cspSource, nonce, message, panelState } = options;
  const csp = [
    "default-src 'none'",
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${cspSource} 'nonce-${nonce}'`
  ].join("; ");
  const retryMessage: RefreshBuildCompareMessage = { type: "refreshBuildCompare" };
  const setState =
    panelState === undefined ? "" : `vscodeApi?.setState?.(${serializeForScript(panelState)});`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    .build-compare-load-error {
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      line-height: 1.5;
      margin: 32px;
      max-width: 640px;
    }
    .build-compare-load-error h1 { font-size: 20px; margin: 0 0 12px; }
    .build-compare-load-error p { margin: 0 0 8px; }
    .build-compare-load-error button {
      margin-top: 8px;
      padding: 4px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font: inherit;
      cursor: pointer;
    }
    .build-compare-load-error button:hover { background: var(--vscode-button-hoverBackground); }
    .build-compare-load-error button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .build-compare-load-error button:disabled { opacity: 0.6; cursor: default; }
  </style>
</head>
<body>
  <main class="build-compare-load-error" role="alert">
    <h1>Build Compare</h1>
    <p>${escapeHtml(message)}</p>
    <p>Retry the comparison, or choose another build pair from Jenkins Workbench.</p>
    <button type="button" id="build-compare-retry">Retry</button>
  </main>
  <script nonce="${nonce}">
    const vscodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
    ${setState}
    const retryButton = document.getElementById("build-compare-retry");
    retryButton?.addEventListener("click", () => {
      retryButton.disabled = true;
      retryButton.textContent = "Retrying…";
      vscodeApi?.postMessage(${serializeForScript(retryMessage)});
    });
  </script>
</body>
</html>`;
}

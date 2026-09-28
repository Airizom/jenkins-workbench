import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import { escapeHtml } from "../../../shared/html";
import type { JenkinsEnvironmentStore } from "../../../storage/JenkinsEnvironmentStore";
import { type LoadingSkeletonVariant, renderLoadingSkeletonHtml } from "./LoadingSkeletonHtml";
import { resolveWebviewAssets, type WebviewEntryName } from "./WebviewAssets";
import { createNonce } from "./WebviewNonce";
import { resolveEnvironmentRef, type SerializedEnvironmentState } from "./WebviewPanelState";

export interface WebviewRenderOptions {
  cspSource: string;
  nonce: string;
  scriptUri?: string;
  styleUris: string[];
}

function renderWebviewShell(content: string, options: WebviewRenderOptions): string {
  // Styles allow 'unsafe-inline' (the VS Code webview convention) because React
  // components set inline `style=""` attributes (progress bar widths, graph
  // backgrounds); a style nonce would disable those, as nonces only authorize
  // <style> elements. Scripts stay nonce-gated.
  const csp = [
    "default-src 'none'",
    `style-src ${options.cspSource} 'unsafe-inline'`,
    `script-src ${options.cspSource} 'nonce-${options.nonce}'`
  ].join("; ");
  const styleLinks = options.styleUris
    .map((href) => `  <link rel="stylesheet" href="${href}" />`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
${styleLinks}
</head>
<body>
  ${content}
</body>
</html>`;
}

export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

interface PanelErrorContent {
  title: string;
  message: string;
  hint: string;
  /** Small label above the headline naming the panel, e.g. "Build Details". */
  panelName?: string;
  /** Technical follow-up shown in a collapsed "Developer details" section. */
  developerDetails?: string;
  /**
   * Shows a "Reload Window" button. Only honored by
   * `assignWebviewPanelManifestErrorHtml`, which registers the message handler.
   */
  showReloadAction?: boolean;
}

export interface PanelRestoreErrorOptions extends PanelErrorContent {
  nonce: string;
  styleUris: string[];
  panelState?: unknown;
}

export interface PanelManifestErrorOptions extends PanelErrorContent {
  panelState?: unknown;
}

const RELOAD_WINDOW_MESSAGE_TYPE = "jenkinsWorkbench.reloadWindow";

export interface PanelRestoreErrorMessages {
  title: string;
  invalidStateMessage: string;
  missingEnvironmentMessage: string;
  hint: string;
}

export function createPanelRestoreMessages(options: {
  title: string;
  viewNoun: string;
  reopenHint: string;
}): PanelRestoreErrorMessages {
  return {
    title: options.title,
    invalidStateMessage: `This ${options.viewNoun} could not be restored. Reopen it from Jenkins Workbench.`,
    missingEnvironmentMessage: `This ${options.viewNoun} could not be restored because its Jenkins environment was removed.`,
    hint: options.reopenHint
  };
}

export function createMissingPanelAssetsMessages(options: {
  title: string;
  panelLabel: string;
}): PanelManifestErrorOptions {
  return {
    panelName: options.title,
    title: "This panel couldn't load",
    message: `${options.panelLabel} files are missing or damaged, so this panel can't be displayed.`,
    hint: "Reload the window to try again. If the problem continues, reinstall Jenkins Workbench from the Extensions view.",
    developerDetails:
      "The panel's entry was not found in out/webview/manifest.json. When running from source, run npm run compile and reload the window.",
    showReloadAction: true
  };
}

export type PanelRestoreResult<TState extends SerializedEnvironmentState> =
  | { ok: true; state: TState; environment: JenkinsEnvironmentRef }
  | { ok: false };

export async function resolveRestoredPanelEnvironment<
  TState extends SerializedEnvironmentState
>(options: {
  panel: vscode.WebviewPanel;
  extensionUri: vscode.Uri;
  entryName: WebviewEntryName;
  state: unknown;
  isValidState: (state: unknown) => state is TState;
  environmentStore: JenkinsEnvironmentStore;
  messages: PanelRestoreErrorMessages;
}): Promise<PanelRestoreResult<TState>> {
  const { panel, extensionUri, entryName, state, isValidState, environmentStore, messages } =
    options;

  if (!isValidState(state)) {
    assignWebviewPanelManifestErrorHtml(panel, extensionUri, entryName, {
      title: messages.title,
      message: messages.invalidStateMessage,
      hint: messages.hint
    });
    return { ok: false };
  }

  const environment = await resolveEnvironmentRef(environmentStore, state);
  if (!environment) {
    assignWebviewPanelManifestErrorHtml(panel, extensionUri, entryName, {
      title: messages.title,
      message: messages.missingEnvironmentMessage,
      hint: messages.hint,
      panelState: state
    });
    return { ok: false };
  }

  return { ok: true, state, environment };
}

const panelsWithReloadHandler = new WeakSet<vscode.WebviewPanel>();

function isReloadWindowMessage(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === RELOAD_WINDOW_MESSAGE_TYPE
  );
}

// Command URIs are not enabled for panel webviews, so the error page's
// "Reload Window" button posts a message that this handler turns into the
// command. Registered once per panel; panel controllers ignore the message.
function ensureReloadWindowHandler(panel: vscode.WebviewPanel): void {
  if (panelsWithReloadHandler.has(panel)) {
    return;
  }
  panelsWithReloadHandler.add(panel);
  const subscription = panel.webview.onDidReceiveMessage((message: unknown) => {
    if (isReloadWindowMessage(message)) {
      void vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  });
  panel.onDidDispose(() => subscription.dispose());
}

export function assignWebviewPanelManifestErrorHtml(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  entryName: WebviewEntryName,
  options: PanelManifestErrorOptions
): void {
  if (options.showReloadAction) {
    ensureReloadWindowHandler(panel);
  }
  panel.webview.html = renderPanelManifestErrorHtml(
    panel.webview,
    extensionUri,
    entryName,
    options
  );
}

function renderPanelManifestErrorHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entryName: WebviewEntryName,
  options: PanelManifestErrorOptions
): string {
  const nonce = createNonce();
  let styleUris: string[] = [];
  try {
    styleUris = resolveWebviewAssets(webview, extensionUri, entryName).styleUris;
  } catch {
    // keep empty
  }
  return renderPanelRestoreErrorHtml(webview.cspSource, { ...options, nonce, styleUris });
}

export function renderPanelRestoreErrorHtml(
  cspSource: string,
  options: PanelRestoreErrorOptions
): string {
  const { nonce, title, message, hint, panelName, developerDetails, showReloadAction } = options;
  // Callers pass plain text, and `message` can embed server-controlled error
  // details (for example HTTP status messages), so escape everything centrally.
  const eyebrow = panelName ? `<p class="jw-eyebrow">${escapeHtml(panelName)}</p>` : "";
  // Hidden until the script confirms the webview API is available, so the
  // button never renders as a dead control.
  const reloadAction = showReloadAction
    ? `<div class="jw-actions"><button type="button" id="jw-reload-window" hidden>Reload Window</button></div>`
    : "";
  const details = developerDetails
    ? `<details><summary>Developer details</summary><p>${escapeHtml(developerDetails)}</p></details>`
    : "";
  return renderWebviewShell(
    `
      <main class="jenkins-workbench-panel-message" role="alert">
        ${eyebrow}
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        <p>${escapeHtml(hint)}</p>
        ${reloadAction}
        ${details}
      </main>
      ${renderErrorPageScript(options.panelState, nonce, showReloadAction === true)}
      <style>
        .jenkins-workbench-panel-message {
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
          line-height: 1.5;
          margin: 32px;
          max-width: 60ch;
        }
        .jenkins-workbench-panel-message h1 {
          font-size: 20px;
          margin: 0 0 12px;
        }
        .jenkins-workbench-panel-message p {
          margin: 0 0 8px;
        }
        .jenkins-workbench-panel-message .jw-eyebrow {
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
          margin-bottom: 4px;
        }
        .jenkins-workbench-panel-message .jw-actions {
          margin: 16px 0;
        }
        .jenkins-workbench-panel-message button {
          background: var(--vscode-button-background);
          border: 1px solid var(--vscode-button-border, transparent);
          border-radius: 2px;
          color: var(--vscode-button-foreground);
          cursor: pointer;
          font: inherit;
          padding: 4px 12px;
        }
        .jenkins-workbench-panel-message button:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .jenkins-workbench-panel-message button:focus-visible,
        .jenkins-workbench-panel-message summary:focus-visible {
          outline: 2px solid var(--vscode-focusBorder);
          outline-offset: 2px;
        }
        .jenkins-workbench-panel-message details {
          color: var(--vscode-descriptionForeground);
          margin-top: 16px;
        }
        .jenkins-workbench-panel-message summary {
          cursor: pointer;
          margin-bottom: 4px;
        }
      </style>
    `,
    { cspSource, nonce, styleUris: options.styleUris }
  );
}

// Acquires the webview API once (a second `acquireVsCodeApi()` call throws),
// restores panel state, and wires the optional reload button.
function renderErrorPageScript(state: unknown, nonce: string, withReload: boolean): string {
  if (state === undefined && !withReload) {
    return "";
  }
  const restoreState =
    state === undefined
      ? ""
      : `
      if (vscodeApi && typeof vscodeApi.setState === "function") {
        vscodeApi.setState(${serializeForScript(state)});
      }`;
  const bindReload = withReload
    ? `
      const reloadButton = document.getElementById("jw-reload-window");
      if (vscodeApi && reloadButton) {
        reloadButton.hidden = false;
        reloadButton.addEventListener("click", () => {
          vscodeApi.postMessage({ type: ${JSON.stringify(RELOAD_WINDOW_MESSAGE_TYPE)} });
        });
      }`
    : "";
  return `
    <script nonce="${nonce}">
      const vscodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;${restoreState}${bindReload}
    </script>
  `;
}

export type PanelDetailsRenderOptions = WebviewRenderOptions & { panelState?: unknown };

export interface TypedPanelRendererOptions {
  entryName: WebviewEntryName;
  skeletonVariant: LoadingSkeletonVariant;
}

export function renderPanelLoadingHtml(
  options: PanelDetailsRenderOptions,
  skeletonVariant: LoadingSkeletonVariant
): string {
  const stateScript = renderWebviewStateScript(options.panelState, options.nonce);
  return renderWebviewShell(`${stateScript}${renderLoadingSkeletonHtml(skeletonVariant)}`, options);
}

export function createTypedPanelRenderer<TModel>(
  options: LoadingSkeletonVariant | TypedPanelRendererOptions
) {
  const entryName = typeof options === "string" ? undefined : options.entryName;
  const skeletonVariant = typeof options === "string" ? options : options.skeletonVariant;
  return {
    entryName,
    renderLoadingHtml: (options: PanelDetailsRenderOptions): string =>
      renderPanelLoadingHtml(options, skeletonVariant),
    renderPanelHtml: (model: TModel, options: PanelDetailsRenderOptions): string =>
      renderPanelAppHtml(model, options)
  };
}

function renderPanelAppHtml(initialModel: unknown, options: PanelDetailsRenderOptions): string {
  const initialState = serializeForScript(initialModel);
  const scriptUri = options.scriptUri ?? "";
  const stateScript = renderInjectedWebviewStateScript(options.panelState, options.nonce);
  return renderWebviewShell(
    `
      ${stateScript}
      <div id="root"></div>
      <script nonce="${options.nonce}">
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script type="module" nonce="${options.nonce}" src="${scriptUri}"></script>
    `,
    options
  );
}

function renderWebviewStateScript(state: unknown, nonce: string): string {
  if (state === undefined) {
    return "";
  }
  const serialized = serializeForScript(state);
  return `
    <script nonce="${nonce}">
      const vscodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
      if (vscodeApi && typeof vscodeApi.setState === "function") {
        vscodeApi.setState(${serialized});
      }
    </script>
  `;
}

function renderInjectedWebviewStateScript(state: unknown, nonce: string): string {
  if (state === undefined) {
    return "";
  }
  const serialized = serializeForScript(state);
  return `
    <script nonce="${nonce}">
      window.__JENKINS_WORKBENCH_PANEL_STATE__ = ${serialized};
    </script>
  `;
}

import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../../../storage/JenkinsEnvironmentStore";
import { type LoadingSkeletonVariant, renderLoadingSkeletonHtml } from "./LoadingSkeletonHtml";
import { type WebviewEntryName, resolveWebviewAssets } from "./WebviewAssets";
import { createNonce } from "./WebviewNonce";
import { type SerializedEnvironmentState, resolveEnvironmentRef } from "./WebviewPanelState";

export interface WebviewRenderOptions {
  cspSource: string;
  nonce: string;
  scriptUri?: string;
  styleUris: string[];
}

export function renderWebviewShell(content: string, options: WebviewRenderOptions): string {
  const csp = [
    "default-src 'none'",
    `style-src ${options.cspSource} 'nonce-${options.nonce}'`,
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

export interface PanelRestoreErrorOptions {
  nonce: string;
  title: string;
  message: string;
  hint: string;
  styleUris: string[];
  panelState?: unknown;
}

export interface PanelManifestErrorOptions {
  title: string;
  message: string;
  hint: string;
  panelState?: unknown;
}

export interface PanelRestoreErrorMessages {
  title: string;
  invalidStateMessage: string;
  missingEnvironmentMessage: string;
  hint: string;
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

export function assignWebviewPanelManifestErrorHtml(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  entryName: WebviewEntryName,
  options: PanelManifestErrorOptions
): void {
  panel.webview.html = renderPanelManifestErrorHtml(
    panel.webview,
    extensionUri,
    entryName,
    options
  );
}

export function renderPanelManifestErrorHtml(
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
  return renderPanelRestoreErrorHtml(webview.cspSource, {
    nonce,
    title: options.title,
    message: options.message,
    hint: options.hint,
    styleUris,
    panelState: options.panelState
  });
}

export function renderPanelRestoreErrorHtml(
  cspSource: string,
  options: PanelRestoreErrorOptions
): string {
  const { nonce, title, message, hint, styleUris, panelState } = options;
  const stateScript = renderWebviewStateScript(panelState, nonce);
  return renderWebviewShell(
    `
      ${stateScript}
      <main class="jenkins-workbench-panel-message">
        <h1>${title}</h1>
        <p>${message}</p>
        <p>${hint}</p>
      </main>
      <style nonce="${nonce}">
        .jenkins-workbench-panel-message {
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
          line-height: 1.5;
          margin: 32px;
        }
        .jenkins-workbench-panel-message h1 {
          font-size: 20px;
          margin: 0 0 12px;
        }
        .jenkins-workbench-panel-message p {
          margin: 0 0 8px;
        }
      </style>
    `,
    { cspSource, nonce, styleUris }
  );
}

export type PanelDetailsRenderOptions = WebviewRenderOptions & { panelState?: unknown };

export function renderPanelLoadingHtml(
  options: PanelDetailsRenderOptions,
  skeletonVariant: LoadingSkeletonVariant
): string {
  const stateScript = renderWebviewStateScript(options.panelState, options.nonce);
  return renderWebviewShell(`${stateScript}${renderLoadingSkeletonHtml(skeletonVariant)}`, options);
}

export function createPanelLoadingRenderer(skeletonVariant: LoadingSkeletonVariant) {
  return (options: PanelDetailsRenderOptions): string =>
    renderPanelLoadingHtml(options, skeletonVariant);
}

export function createPanelAppRenderer(skeletonVariant: LoadingSkeletonVariant) {
  return {
    renderLoadingHtml: createPanelLoadingRenderer(skeletonVariant),
    renderAppHtml: renderPanelAppHtml
  };
}

export function createTypedPanelRenderer<TModel>(skeletonVariant: LoadingSkeletonVariant) {
  const { renderLoadingHtml, renderAppHtml } = createPanelAppRenderer(skeletonVariant);
  return {
    renderLoadingHtml,
    renderPanelHtml: (model: TModel, options: PanelDetailsRenderOptions): string =>
      renderAppHtml(model, options)
  };
}

export function renderPanelAppHtml(
  initialModel: unknown,
  options: PanelDetailsRenderOptions
): string {
  const initialState = serializeForScript(initialModel);
  const scriptUri = options.scriptUri ?? "";
  const stateScript = renderWebviewStateScript(options.panelState, options.nonce);
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

export function renderWebviewStateScript(state: unknown, nonce: string): string {
  if (state === undefined) {
    return "";
  }
  const serialized = serializeForScript(state);
  return `
    <script nonce="${nonce}">
      const vscodeApi =
        window.__vscodeApi__ ??
        (typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined);
      if (vscodeApi) {
        window.__vscodeApi__ = vscodeApi;
      }
      if (vscodeApi && typeof vscodeApi.setState === "function") {
        vscodeApi.setState(${serialized});
      }
    </script>
  `;
}

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

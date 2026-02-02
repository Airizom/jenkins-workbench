export interface WebviewRenderOptions {
  cspSource: string;
  nonce: string;
  scriptUri?: string;
  styleUri: string;
}

export function renderWebviewShell(content: string, options: WebviewRenderOptions): string {
  const csp = [
    "default-src 'none'",
    `style-src ${options.cspSource} 'nonce-${options.nonce}'`,
    `script-src ${options.cspSource} 'nonce-${options.nonce}'`
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${options.styleUri}" />
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

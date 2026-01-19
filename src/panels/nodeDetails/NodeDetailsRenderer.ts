import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

interface NodeDetailsRenderOptions {
  cspSource: string;
  nonce: string;
  scriptUri?: string;
  styleUri: string;
}

export function renderLoadingHtml(options: NodeDetailsRenderOptions): string {
  return renderShell(
    `
      <div class="p-6 flex flex-col gap-2">
        <div class="text-lg font-semibold text-foreground">Loading node details...</div>
        <div class="text-sm text-description">Fetching node status and executor data.</div>
      </div>
    `,
    options
  );
}

export function renderNodeDetailsHtml(
  model: NodeDetailsViewModel,
  options: NodeDetailsRenderOptions
): string {
  const initialState = serializeForScript(model);
  const scriptUri = options.scriptUri ?? "";
  return renderShell(
    `
      <div id="root"></div>
      <script nonce="${options.nonce}">
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${options.nonce}" src="${scriptUri}"></script>
    `,
    options
  );
}

export function renderShell(content: string, options: NodeDetailsRenderOptions): string {
  const csp = [
    "default-src 'none'",
    `style-src ${options.cspSource}`,
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

function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

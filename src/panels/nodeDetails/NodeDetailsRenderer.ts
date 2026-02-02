import { renderLoadingSkeletonHtml } from "../shared/webview/LoadingSkeletonHtml";
import {
  type WebviewRenderOptions,
  renderWebviewShell,
  renderWebviewStateScript,
  serializeForScript
} from "../shared/webview/WebviewHtml";
import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

export type NodeDetailsRenderOptions = WebviewRenderOptions & { panelState?: unknown };

export function renderLoadingHtml(options: NodeDetailsRenderOptions): string {
  const stateScript = renderWebviewStateScript(options.panelState, options.nonce);
  return renderWebviewShell(`${stateScript}${renderLoadingSkeletonHtml("node")}`, options);
}

export function renderNodeDetailsHtml(
  model: NodeDetailsViewModel,
  options: NodeDetailsRenderOptions
): string {
  const initialState = serializeForScript(model);
  const scriptUri = options.scriptUri ?? "";
  const stateScript = renderWebviewStateScript(options.panelState, options.nonce);
  return renderWebviewShell(
    `
      ${stateScript}
      <div id="root"></div>
      <script nonce="${options.nonce}">
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${options.nonce}" src="${scriptUri}"></script>
    `,
    options
  );
}

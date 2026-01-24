import { renderLoadingSkeletonHtml } from "../shared/webview/LoadingSkeletonHtml";
import {
  renderWebviewShell,
  serializeForScript,
  type WebviewRenderOptions
} from "../shared/webview/WebviewHtml";
import type { NodeDetailsViewModel } from "./NodeDetailsViewModel";

export type NodeDetailsRenderOptions = WebviewRenderOptions;

export function renderLoadingHtml(options: NodeDetailsRenderOptions): string {
  return renderWebviewShell(renderLoadingSkeletonHtml("node"), options);
}

export function renderNodeDetailsHtml(
  model: NodeDetailsViewModel,
  options: NodeDetailsRenderOptions
): string {
  const initialState = serializeForScript(model);
  const scriptUri = options.scriptUri ?? "";
  return renderWebviewShell(
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

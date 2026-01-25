import { renderLoadingSkeletonHtml } from "../shared/webview/LoadingSkeletonHtml";
import {
  type WebviewRenderOptions,
  renderWebviewShell,
  serializeForScript
} from "../shared/webview/WebviewHtml";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export type BuildDetailsRenderOptions = WebviewRenderOptions;

export function renderLoadingHtml(options: BuildDetailsRenderOptions): string {
  return renderWebviewShell(renderLoadingSkeletonHtml("build"), options);
}

export function renderBuildDetailsHtml(
  model: BuildDetailsViewModel,
  options: BuildDetailsRenderOptions
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

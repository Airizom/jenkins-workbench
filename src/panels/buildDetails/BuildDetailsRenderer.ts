import { renderLoadingSkeletonHtml } from "../shared/webview/LoadingSkeletonHtml";
import {
  type WebviewRenderOptions,
  renderWebviewShell,
  renderWebviewStateScript,
  serializeForScript
} from "../shared/webview/WebviewHtml";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";

export type BuildDetailsRenderOptions = WebviewRenderOptions & { panelState?: unknown };

export function renderLoadingHtml(options: BuildDetailsRenderOptions): string {
  const stateScript = renderWebviewStateScript(options.panelState, options.nonce);
  return renderWebviewShell(`${stateScript}${renderLoadingSkeletonHtml("build")}`, options);
}

export function renderBuildDetailsHtml(
  model: BuildDetailsViewModel,
  options: BuildDetailsRenderOptions
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
      <script type="module" nonce="${options.nonce}" src="${scriptUri}"></script>
    `,
    options
  );
}

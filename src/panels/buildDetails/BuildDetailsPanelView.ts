import type * as vscode from "vscode";
import {
  type EnvironmentPanelRenderOptions,
  EnvironmentPanelView
} from "../shared/webview/PanelViewHelpers";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import { renderBuildDetailsHtml } from "./BuildDetailsRenderer";
import { buildUpdateMessageFromState } from "./BuildDetailsUpdateBuilder";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";
import type { BuildDetailsOutgoingMessage } from "./shared/BuildDetailsPanelMessages";

export type BuildDetailsPanelRenderOptions = EnvironmentPanelRenderOptions;

interface BuildDetailsPanelViewRuntimeSurface {
  postStateUpdate(
    state: BuildDetailsPanelState,
    options?: { canOpenSource?: (className?: string) => boolean; coverageEnabled?: boolean }
  ): void;
  postConsoleSnapshot(snapshot: {
    consoleTextResult?: { text: string; truncated: boolean };
    consoleHtmlResult?: { html: string; truncated: boolean };
  }): void;
}

export class BuildDetailsPanelView
  extends EnvironmentPanelView<BuildDetailsViewModel>
  implements BuildDetailsPanelViewRuntimeSurface
{
  constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    super(panel, extensionUri, "buildDetails", "build", "Build Details", renderBuildDetailsHtml);
  }

  renderBuildDetails(
    model: BuildDetailsViewModel,
    assets: NonNullable<ReturnType<BuildDetailsPanelView["resolveAssets"]>>,
    options: BuildDetailsPanelRenderOptions
  ): void {
    this.renderModel(model, assets, options);
  }

  isVisible(): boolean {
    return this.panel.visible;
  }

  postMessage(message: BuildDetailsOutgoingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  postStateUpdate(
    state: BuildDetailsPanelState,
    options?: { canOpenSource?: (className?: string) => boolean; coverageEnabled?: boolean }
  ): void {
    const updateMessage = buildUpdateMessageFromState(state, options);
    if (updateMessage) {
      this.postMessage(updateMessage);
    }
  }

  postErrors(errors: string[]): void {
    this.postMessage({ type: "setErrors", errors });
  }

  setLoading(value: boolean): void {
    this.postMessage({ type: "setLoading", value });
  }

  postConsoleSnapshot(snapshot: {
    consoleTextResult?: { text: string; truncated: boolean };
    consoleHtmlResult?: { html: string; truncated: boolean };
  }): void {
    if (snapshot.consoleHtmlResult) {
      this.postMessage({
        type: "setConsoleHtml",
        html: snapshot.consoleHtmlResult.html,
        truncated: snapshot.consoleHtmlResult.truncated
      });
      return;
    }
    if (!snapshot.consoleTextResult) {
      return;
    }
    this.postMessage({
      type: "setConsole",
      text: snapshot.consoleTextResult.text,
      truncated: snapshot.consoleTextResult.truncated
    });
  }
}

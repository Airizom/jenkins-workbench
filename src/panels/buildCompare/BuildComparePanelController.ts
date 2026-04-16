import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { formatError } from "../buildDetails/BuildDetailsFormatters";
import { createNonce } from "../shared/webview/WebviewNonce";
import type { BuildCompareBackend } from "./BuildCompareBackend";
import type { BuildCompareOptions } from "./BuildCompareOptions";
import { BuildComparePanelView } from "./BuildComparePanelView";
import {
  loadBuildCompareConsoleViewModel,
  loadBuildCompareViewModel
} from "./BuildCompareViewModel";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

export interface BuildComparePanelLoadOptions {
  label?: string;
  panelState?: unknown;
}

export type BuildComparePanelLoadResult = { status: "ok" } | { status: "missingAssets" };

export class BuildComparePanelController {
  private readonly view: BuildComparePanelView;
  private loadToken = 0;

  constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.view = new BuildComparePanelView(panel, extensionUri);
  }

  async load(
    backend: BuildCompareBackend,
    compareOptions: BuildCompareOptions,
    environment: JenkinsEnvironmentRef,
    baselineBuildUrl: string,
    targetBuildUrl: string,
    options?: BuildComparePanelLoadOptions
  ): Promise<BuildComparePanelLoadResult> {
    const token = ++this.loadToken;
    const nonce = createNonce();
    const assets = this.view.resolveAssets();
    if (!assets) {
      return { status: "missingAssets" };
    }

    this.view.renderLoading({
      nonce,
      styleUris: assets.styleUris,
      panelState: options?.panelState
    });

    let model: BuildCompareViewModel;
    try {
      model = await loadBuildCompareViewModel(backend, {
        compareOptions,
        environment,
        baselineBuildUrl,
        targetBuildUrl
      });
    } catch (error) {
      if (token !== this.loadToken) {
        return { status: "ok" };
      }
      this.view.setTitle(options?.label);
      this.view.renderError(`Build comparison could not be loaded. ${formatError(error)}`, {
        nonce,
        panelState: options?.panelState
      });
      throw error;
    }
    if (token !== this.loadToken) {
      return { status: "ok" };
    }

    this.view.setTitle(
      options?.label ?? `${model.baseline.displayName} vs ${model.target.displayName}`
    );
    this.view.renderBuildCompare(model, assets, {
      nonce,
      panelState: options?.panelState
    });
    void this.loadConsoleSection(
      token,
      backend,
      compareOptions,
      environment,
      baselineBuildUrl,
      targetBuildUrl
    );
    return { status: "ok" };
  }

  private async loadConsoleSection(
    token: number,
    backend: BuildCompareBackend,
    compareOptions: BuildCompareOptions,
    environment: JenkinsEnvironmentRef,
    baselineBuildUrl: string,
    targetBuildUrl: string
  ): Promise<void> {
    const console = await loadBuildCompareConsoleViewModel(backend, {
      compareOptions,
      environment,
      baselineBuildUrl,
      targetBuildUrl
    });
    if (token !== this.loadToken) {
      return;
    }
    await this.view.postMessage({
      type: "updateConsoleSection",
      console
    });
  }
}

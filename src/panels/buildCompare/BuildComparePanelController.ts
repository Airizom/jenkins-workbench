import type * as vscode from "vscode";
import { formatError } from "../../formatters/ErrorFormatters";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { BuildInspectionBackend as BuildCompareBackend } from "../shared/backend/BuildInspectionBackend";
import { LoadTokenTracker } from "../shared/PanelRuntimeHelpers";
import { createNonce } from "../shared/webview/WebviewNonce";
import type { BuildCompareOptions } from "./BuildCompareOptions";
import { BuildComparePanelView } from "./BuildComparePanelView";
import {
  loadBuildCompareConsoleViewModel,
  loadBuildCompareViewModel
} from "./BuildCompareViewModel";
import type {
  BuildCompareConsoleSectionViewModel,
  BuildCompareViewModel
} from "./shared/BuildCompareContracts";
import type { BuildCompareOutgoingMessage } from "./shared/BuildComparePanelMessages";
import type { BuildComparePanelSerializedState } from "./shared/BuildComparePanelWebviewState";

export interface BuildComparePanelLoadOptions {
  label?: string;
  panelState?: unknown;
}

export type BuildComparePanelLoadResult = { status: "ok" } | { status: "missingAssets" };

export interface BuildComparePanelRefreshOptions {
  label?: string;
  panelState: BuildComparePanelSerializedState;
}

export class BuildComparePanelController {
  private readonly view: BuildComparePanelView;
  private readonly loadTokenTracker = new LoadTokenTracker();
  private loadedConsoleSection?: BuildCompareConsoleSectionViewModel;
  private hasRenderedComparison = false;

  constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.view = new BuildComparePanelView(panel, extensionUri);
  }

  /** Invalidates in-flight loads so they stop posting to a disposed webview. */
  dispose(): void {
    this.loadTokenTracker.next();
    this.loadedConsoleSection = undefined;
    this.hasRenderedComparison = false;
  }

  /** True once the React app shows a comparison that refresh/swap can update in place. */
  get canUpdateInPlace(): boolean {
    return this.hasRenderedComparison;
  }

  /**
   * Re-sends the console section when the webview signals it is ready; the
   * initial updateConsoleSection message is dropped if it arrives before the
   * React app attaches its window message listener.
   */
  async handleWebviewReady(): Promise<void> {
    if (!this.loadedConsoleSection) {
      return;
    }
    await this.view.postMessage({
      type: "updateConsoleSection",
      console: this.loadedConsoleSection
    });
  }

  async load(
    backend: BuildCompareBackend,
    compareOptions: BuildCompareOptions,
    environment: JenkinsEnvironmentRef,
    baselineBuildUrl: string,
    targetBuildUrl: string,
    options?: BuildComparePanelLoadOptions
  ): Promise<BuildComparePanelLoadResult> {
    const token = this.loadTokenTracker.next();
    this.loadedConsoleSection = undefined;
    this.hasRenderedComparison = false;
    const nonce = createNonce();
    const assets = this.view.resolveAssetsAndRenderLoading({
      nonce,
      panelState: options?.panelState
    });
    if (!assets) {
      return { status: "missingAssets" };
    }

    let model: BuildCompareViewModel;
    try {
      model = await loadBuildCompareViewModel(backend, {
        compareOptions,
        environment,
        baselineBuildUrl,
        targetBuildUrl
      });
    } catch (error) {
      if (!this.loadTokenTracker.isCurrent(token)) {
        return { status: "ok" };
      }
      this.view.setTitle(options?.label);
      this.view.renderError(`Build comparison could not be loaded. ${formatError(error)}`, {
        nonce,
        panelState: options?.panelState
      });
      throw error;
    }
    if (!this.loadTokenTracker.isCurrent(token)) {
      return { status: "ok" };
    }

    this.view.setTitle(
      options?.label ?? `${model.baseline.displayName} vs ${model.target.displayName}`
    );
    this.view.renderBuildCompare(model, assets, {
      nonce,
      panelState: options?.panelState
    });
    this.hasRenderedComparison = true;
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

  /**
   * Reloads the comparison and posts it to the already-rendered webview. On
   * failure the webview keeps its last good content and shows the error inline.
   * Resolves to false when a newer load superseded this one.
   */
  async refresh(
    backend: BuildCompareBackend,
    compareOptions: BuildCompareOptions,
    environment: JenkinsEnvironmentRef,
    baselineBuildUrl: string,
    targetBuildUrl: string,
    options: BuildComparePanelRefreshOptions
  ): Promise<boolean> {
    const token = this.loadTokenTracker.next();
    const previousConsoleSection = this.loadedConsoleSection;
    this.loadedConsoleSection = undefined;

    let model: BuildCompareViewModel;
    try {
      model = await loadBuildCompareViewModel(backend, {
        compareOptions,
        environment,
        baselineBuildUrl,
        targetBuildUrl
      });
    } catch (error) {
      if (!this.loadTokenTracker.isCurrent(token)) {
        return false;
      }
      this.loadedConsoleSection = previousConsoleSection;
      await this.view.postMessage({
        type: "buildCompareRefreshFailed",
        message: `Build comparison could not be refreshed. ${formatError(error)}`
      } satisfies BuildCompareOutgoingMessage);
      throw error;
    }
    if (!this.loadTokenTracker.isCurrent(token)) {
      return false;
    }

    this.view.setTitle(
      options.label ?? `${model.baseline.displayName} vs ${model.target.displayName}`
    );
    await this.view.postMessage({
      type: "updateBuildCompare",
      model,
      panelState: options.panelState
    } satisfies BuildCompareOutgoingMessage);
    void this.loadConsoleSection(
      token,
      backend,
      compareOptions,
      environment,
      baselineBuildUrl,
      targetBuildUrl
    );
    return true;
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
    if (!this.loadTokenTracker.isCurrent(token)) {
      return;
    }
    this.loadedConsoleSection = console;
    await this.view.postMessage({
      type: "updateConsoleSection",
      console
    } satisfies BuildCompareOutgoingMessage);
  }
}

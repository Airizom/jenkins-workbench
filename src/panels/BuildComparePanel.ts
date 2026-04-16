import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { BuildDetailsPanelLauncher } from "./BuildDetailsPanelLauncher";
import type { BuildCompareBackend } from "./buildCompare/BuildCompareBackend";
import type { BuildCompareOptions } from "./buildCompare/BuildCompareOptions";
import {
  BuildComparePanelController,
  type BuildComparePanelLoadResult
} from "./buildCompare/BuildComparePanelController";
import {
  isOpenBuildDetailsMessage,
  isSwapBuildsMessage
} from "./buildCompare/shared/BuildComparePanelMessages";
import {
  type BuildComparePanelSerializedState,
  createBuildComparePanelState,
  isBuildComparePanelState,
  updateBuildComparePanelState
} from "./buildCompare/shared/BuildComparePanelWebviewState";
import { formatError } from "./buildDetails/BuildDetailsFormatters";
import { getWebviewAssetsRoot, resolveWebviewAssets } from "./shared/webview/WebviewAssets";
import { renderPanelRestoreErrorHtml } from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import { resolveEnvironmentRef } from "./shared/webview/WebviewPanelState";

interface BuildComparePanelShowOptions {
  backend: BuildCompareBackend;
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher;
  getCompareOptions: () => BuildCompareOptions;
  environment: JenkinsEnvironmentRef;
  baselineBuildUrl: string;
  targetBuildUrl: string;
  extensionUri: vscode.Uri;
  label?: string;
}

interface BuildComparePanelReviveOptions {
  backend: BuildCompareBackend;
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher;
  getCompareOptions: () => BuildCompareOptions;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
}

export class BuildComparePanel {
  private static currentPanel: BuildComparePanel | undefined;
  private static readonly PANEL_TITLE = "Build Compare";
  private readonly controller: BuildComparePanelController;
  private readonly disposables: vscode.Disposable[] = [];
  private serializedState?: BuildComparePanelSerializedState;
  private backend?: BuildCompareBackend;
  private getCompareOptions?: () => BuildCompareOptions;
  private environment?: JenkinsEnvironmentRef;
  private label?: string;

  static async show(options: BuildComparePanelShowOptions): Promise<void> {
    if (!BuildComparePanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.buildCompare",
        BuildComparePanel.PANEL_TITLE,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getWebviewAssetsRoot(options.extensionUri)]
        }
      );
      BuildComparePanel.configurePanel(panel, options.extensionUri);
      BuildComparePanel.currentPanel = new BuildComparePanel(
        panel,
        options.extensionUri,
        options.buildDetailsPanelLauncher
      );
    }

    const activePanel = BuildComparePanel.currentPanel;
    activePanel.panel.reveal(undefined, true);
    activePanel.label = options.label;
    activePanel.environment = options.environment;
    activePanel.backend = options.backend;
    activePanel.getCompareOptions = options.getCompareOptions;
    activePanel.serializedState = createBuildComparePanelState(
      options.environment,
      options.baselineBuildUrl,
      options.targetBuildUrl
    );
    await activePanel.load();
  }

  static async revive(
    panel: vscode.WebviewPanel,
    state: unknown,
    options: BuildComparePanelReviveOptions
  ): Promise<void> {
    BuildComparePanel.configurePanel(panel, options.extensionUri);
    panel.title = BuildComparePanel.PANEL_TITLE;

    const revived = new BuildComparePanel(
      panel,
      options.extensionUri,
      options.buildDetailsPanelLauncher
    );
    BuildComparePanel.currentPanel = revived;
    revived.backend = options.backend;
    revived.getCompareOptions = options.getCompareOptions;

    if (!isBuildComparePanelState(state)) {
      revived.renderRestoreError(
        "This build comparison view could not be restored. Reopen it from Jenkins Workbench."
      );
      return;
    }

    const environment = await resolveEnvironmentRef(options.environmentStore, state);
    if (!environment) {
      revived.renderRestoreError(
        "This build comparison view could not be restored because its Jenkins environment was removed.",
        state
      );
      return;
    }

    revived.environment = environment;
    revived.serializedState = state;
    await revived.load({ suppressErrors: true });
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly buildDetailsPanelLauncher: BuildDetailsPanelLauncher
  ) {
    this.controller = new BuildComparePanelController(panel, extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (isSwapBuildsMessage(message)) {
          void this.swapBuilds();
          return;
        }
        if (isOpenBuildDetailsMessage(message)) {
          void this.openBuildDetails(message.side);
        }
      },
      null,
      this.disposables
    );
  }

  private dispose(): void {
    BuildComparePanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private async load(options?: { suppressErrors?: boolean }): Promise<void> {
    if (!this.backend || !this.getCompareOptions || !this.environment || !this.serializedState) {
      return;
    }

    let result: BuildComparePanelLoadResult;
    try {
      result = await this.controller.load(
        this.backend,
        this.getCompareOptions(),
        this.environment,
        this.serializedState.baselineBuildUrl,
        this.serializedState.targetBuildUrl,
        {
          label: this.label,
          panelState: this.serializedState
        }
      );
    } catch (error) {
      if (options?.suppressErrors) {
        this.renderRestoreError(
          `Build comparison could not be loaded. ${formatError(error)}`,
          this.serializedState
        );
        return;
      }
      throw error;
    }

    if (result.status === "missingAssets") {
      this.renderRestoreError(
        "Build compare webview assets are missing. Run the extension build (npm run compile) and try again.",
        this.serializedState
      );
    }
  }

  private async swapBuilds(): Promise<void> {
    if (!this.serializedState) {
      return;
    }
    this.serializedState = updateBuildComparePanelState(
      this.serializedState,
      this.serializedState.targetBuildUrl,
      this.serializedState.baselineBuildUrl
    );
    await this.load({ suppressErrors: true });
  }

  private async openBuildDetails(side: "baseline" | "target"): Promise<void> {
    if (!this.environment || !this.serializedState) {
      return;
    }
    await this.buildDetailsPanelLauncher.show({
      environment: this.environment,
      buildUrl: this.getBuildUrlForSide(side),
      label: side === "baseline" ? "Baseline" : "Target"
    });
  }

  private getBuildUrlForSide(side: "baseline" | "target"): string {
    if (!this.serializedState) {
      return "";
    }
    return side === "baseline"
      ? this.serializedState.baselineBuildUrl
      : this.serializedState.targetBuildUrl;
  }

  private static configurePanel(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewAssetsRoot(extensionUri)]
    };
    panel.iconPath = BuildComparePanel.getIconPaths(extensionUri);
  }

  private static getIconPaths(extensionUri: vscode.Uri): { light: vscode.Uri; dark: vscode.Uri } {
    const lightIconPath = vscode.Uri.joinPath(
      extensionUri,
      "resources",
      "codicons",
      "terminal-light.svg"
    );
    const darkIconPath = vscode.Uri.joinPath(
      extensionUri,
      "resources",
      "codicons",
      "terminal-dark.svg"
    );
    return { light: lightIconPath, dark: darkIconPath };
  }

  private renderRestoreError(message: string, panelState?: BuildComparePanelSerializedState): void {
    const nonce = createNonce();
    let styleUris: string[] = [];
    try {
      styleUris = resolveWebviewAssets(
        this.panel.webview,
        this.extensionUri,
        "buildCompare"
      ).styleUris;
    } catch {
      // keep empty
    }

    this.panel.webview.html = renderPanelRestoreErrorHtml(this.panel.webview.cspSource, {
      nonce,
      title: BuildComparePanel.PANEL_TITLE,
      message,
      hint: "Open the comparison again from Jenkins Workbench to continue.",
      styleUris,
      panelState: panelState ?? this.serializedState
    });
  }
}

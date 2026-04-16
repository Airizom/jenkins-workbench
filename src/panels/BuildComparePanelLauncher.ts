import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { BuildComparePanel } from "./BuildComparePanel";
import type { BuildDetailsPanelLauncher } from "./BuildDetailsPanelLauncher";
import type { BuildCompareBackend } from "./buildCompare/BuildCompareBackend";
import type { BuildCompareOptions } from "./buildCompare/BuildCompareOptions";

export interface BuildComparePanelLaunchRequest {
  environment: JenkinsEnvironmentRef;
  baselineBuildUrl: string;
  targetBuildUrl: string;
  label?: string;
}

export interface BuildComparePanelLauncherOptions {
  backend: BuildCompareBackend;
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher;
  getCompareOptions: () => BuildCompareOptions;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
}

export class BuildComparePanelLauncher {
  constructor(private readonly options: BuildComparePanelLauncherOptions) {}

  async show(request: BuildComparePanelLaunchRequest): Promise<void> {
    await BuildComparePanel.show({
      ...this.getSharedPanelOptions(),
      environment: request.environment,
      baselineBuildUrl: request.baselineBuildUrl,
      targetBuildUrl: request.targetBuildUrl,
      extensionUri: this.options.extensionUri,
      label: request.label
    });
  }

  async revive(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    await BuildComparePanel.revive(panel, state, {
      ...this.getSharedPanelOptions(),
      environmentStore: this.options.environmentStore,
      extensionUri: this.options.extensionUri
    });
  }

  private getSharedPanelOptions() {
    return {
      backend: this.options.backend,
      buildDetailsPanelLauncher: this.options.buildDetailsPanelLauncher,
      getCompareOptions: this.options.getCompareOptions
    };
  }
}

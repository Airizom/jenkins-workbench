import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { TestSourceNavigationUiService } from "../services/TestSourceNavigationUiService";
import type { TestSourceResolver } from "../services/TestSourceResolver";
import type { BuildRunExpectation } from "../shared/build/BuildCompletionEvidence";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { BuildDetailsPanel, type BuildDetailsPanelServices } from "./BuildDetailsPanel";

export interface PipelineNodeSelection {
  kind: "stage" | "step";
  nodeId: string;
  name?: string;
}

export interface BuildDetailsPanelLaunchRequest {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label?: string;
  pipelineNodeSelection?: PipelineNodeSelection;
  expectedRun?: BuildRunExpectation;
}

export interface BuildDetailsPanelLauncherOptions extends BuildDetailsPanelServices {
  testSourceResolver: TestSourceResolver;
  testSourceNavigationUiService: TestSourceNavigationUiService;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
}

export class BuildDetailsPanelLauncher {
  constructor(private readonly options: BuildDetailsPanelLauncherOptions) {}

  async show(request: BuildDetailsPanelLaunchRequest): Promise<void> {
    await BuildDetailsPanel.show({
      ...this.options,
      ...request
    });
  }

  async revive(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    await BuildDetailsPanel.revive(panel, state, this.options);
  }
}

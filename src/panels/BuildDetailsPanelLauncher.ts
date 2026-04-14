import type * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { TestSourceNavigationService } from "../services/TestSourceNavigationService";
import type { TestSourceNavigationUiService } from "../services/TestSourceNavigationUiService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import { BuildDetailsPanel } from "./BuildDetailsPanel";
import type {
  BuildDetailsDataService,
  PendingInputActionProvider
} from "./buildDetails/BuildDetailsPollingController";

export interface BuildDetailsPanelLaunchRequest {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label?: string;
}

export interface BuildDetailsPanelLauncherOptions {
  dataService: BuildDetailsDataService;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  testSourceNavigationService: TestSourceNavigationService;
  testSourceNavigationUiService: TestSourceNavigationUiService;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: PendingInputActionProvider | undefined;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
}

export class BuildDetailsPanelLauncher {
  constructor(private readonly options: BuildDetailsPanelLauncherOptions) {}

  async show(request: BuildDetailsPanelLaunchRequest): Promise<void> {
    await BuildDetailsPanel.show({
      ...this.getSharedPanelOptions(),
      environment: request.environment,
      buildUrl: request.buildUrl,
      extensionUri: this.options.extensionUri,
      label: request.label
    });
  }

  async revive(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    await BuildDetailsPanel.revive(panel, state, {
      ...this.getSharedPanelOptions(),
      environmentStore: this.options.environmentStore,
      extensionUri: this.options.extensionUri
    });
  }

  private getSharedPanelOptions() {
    return {
      dataService: this.options.dataService,
      artifactActionHandler: this.options.artifactActionHandler,
      consoleExporter: this.options.consoleExporter,
      refreshHost: this.options.refreshHost,
      pendingInputProvider: this.options.pendingInputProvider,
      testSourceNavigationUiService: this.options.testSourceNavigationUiService,
      testSourceNavigationService: this.options.testSourceNavigationService
    };
  }
}

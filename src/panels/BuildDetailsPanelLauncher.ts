import type * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { CoverageDecorationService } from "../services/CoverageDecorationService";
import type { TestSourceNavigationService } from "../services/TestSourceNavigationService";
import type { TestSourceNavigationUiService } from "../services/TestSourceNavigationUiService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import { BuildDetailsPanel } from "./BuildDetailsPanel";
import type {
  BuildDetailsBackend,
  BuildDetailsPendingInputProvider
} from "./buildDetails/BuildDetailsBackend";

export interface BuildDetailsPanelLaunchRequest {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label?: string;
}

export interface BuildDetailsPanelLauncherOptions {
  backend: BuildDetailsBackend;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  coverageDecorationService: CoverageDecorationService;
  testSourceNavigationService: TestSourceNavigationService;
  testSourceNavigationUiService: TestSourceNavigationUiService;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: BuildDetailsPendingInputProvider | undefined;
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
      backend: this.options.backend,
      artifactActionHandler: this.options.artifactActionHandler,
      consoleExporter: this.options.consoleExporter,
      coverageDecorationService: this.options.coverageDecorationService,
      refreshHost: this.options.refreshHost,
      pendingInputProvider: this.options.pendingInputProvider,
      testSourceNavigationUiService: this.options.testSourceNavigationUiService,
      testSourceNavigationService: this.options.testSourceNavigationService
    };
  }
}

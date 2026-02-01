import * as vscode from "vscode";
import type { BuildCommandRefreshHost } from "../commands/build/BuildCommandTypes";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { BuildDetailsPanel } from "../panels/BuildDetailsPanel";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";

export class JenkinsWorkbenchDeepLinkBuildHandler {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly artifactActionHandler: ArtifactActionHandler,
    private readonly consoleExporter: BuildConsoleExporter,
    private readonly refreshHost: BuildCommandRefreshHost,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly extensionUri: vscode.Uri
  ) {}

  async openBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<void> {
    try {
      await BuildDetailsPanel.show(
        this.dataService,
        this.artifactActionHandler,
        this.consoleExporter,
        this.refreshHost,
        this.pendingInputCoordinator,
        environment,
        buildUrl,
        this.extensionUri,
        this.deriveBuildLabel(buildUrl)
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to open build details: ${formatActionError(error)}`
      );
    }
  }

  private deriveBuildLabel(buildUrl: string): string | undefined {
    const match = buildUrl.match(/\/(\d+)\/?$/);
    if (!match) {
      return undefined;
    }
    return `#${match[1]}`;
  }
}

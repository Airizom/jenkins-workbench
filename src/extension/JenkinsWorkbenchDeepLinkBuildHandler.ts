import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildDetailsPanelLauncher } from "../panels/BuildDetailsPanelLauncher";

export class JenkinsWorkbenchDeepLinkBuildHandler {
  constructor(private readonly buildDetailsPanelLauncher: BuildDetailsPanelLauncher) {}

  async openBuildDetails(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    try {
      await this.buildDetailsPanelLauncher.show({
        environment,
        buildUrl,
        label: this.deriveBuildLabel(buildUrl)
      });
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

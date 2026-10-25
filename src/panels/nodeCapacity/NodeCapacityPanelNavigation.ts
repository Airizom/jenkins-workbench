import * as vscode from "vscode";
import { formatActionError } from "../../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash } from "../../jenkins/urls";
import { openJenkinsWorkbenchUrl } from "../../ui/OpenExternalUrl";
import type { BuildDetailsPanelLauncher } from "../BuildDetailsPanelLauncher";
import { NodeDetailsPanel } from "../NodeDetailsPanel";
import type { EnvironmentPanelRefreshHost } from "../shared/PanelRuntimeHelpers";

interface NodeCapacityNavigationContext {
  environment?: JenkinsEnvironmentRef;
  dataService?: JenkinsDataService;
  extensionUri: vscode.Uri;
  refreshHost?: EnvironmentPanelRefreshHost;
  buildDetailsPanelLauncher?: Pick<BuildDetailsPanelLauncher, "show">;
}

export class NodeCapacityPanelNavigation {
  constructor(private readonly getContext: () => NodeCapacityNavigationContext) {}

  /**
   * Webview-supplied node and build URLs feed authenticated requests, so only
   * accept URLs inside this panel's environment (same prefix containment as
   * the URI handler and task provider).
   */
  isUrlWithinEnvironment(url: string): boolean {
    const environmentUrl = this.getContext().environment?.url;
    if (!environmentUrl) {
      return false;
    }
    try {
      const normalizedBase = ensureTrailingSlash(new URL(environmentUrl).toString());
      return new URL(url).toString().startsWith(normalizedBase);
    } catch {
      return false;
    }
  }

  async openBuildDetails(buildUrl: string, label?: string): Promise<void> {
    const { environment, buildDetailsPanelLauncher } = this.getContext();
    if (!environment) {
      return;
    }
    if (!this.isUrlWithinEnvironment(buildUrl)) {
      console.warn(
        `Node Capacity ignored a build details request outside the environment: ${buildUrl}`
      );
      return;
    }
    if (!buildDetailsPanelLauncher) {
      await openJenkinsWorkbenchUrl(buildUrl, "Node Capacity");
      return;
    }
    try {
      await buildDetailsPanelLauncher.show({
        environment,
        buildUrl,
        label
      });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to open build details: ${formatActionError(error)}`
      );
    }
  }

  async openNodeDetails(nodeUrl: string, label?: string): Promise<void> {
    const { dataService, environment, extensionUri, refreshHost } = this.getContext();
    if (!dataService || !environment) {
      return;
    }
    if (!this.isUrlWithinEnvironment(nodeUrl)) {
      console.warn(
        `Node Capacity ignored a node details request outside the environment: ${nodeUrl}`
      );
      return;
    }
    await NodeDetailsPanel.show({
      dataService,
      environment,
      nodeUrl,
      extensionUri,
      label,
      refreshHost
    });
  }
}

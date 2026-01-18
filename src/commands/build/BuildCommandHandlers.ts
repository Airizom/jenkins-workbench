import * as vscode from "vscode";
import type { JenkinsDataService, JobParameter } from "../../jenkins/JenkinsDataService";
import type { BuildConsoleExporter } from "../../services/BuildConsoleExporter";
import type { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import { BuildDetailsPanel } from "../../panels/BuildDetailsPanel";
import type { PendingInputActionProvider } from "../../panels/buildDetails/BuildDetailsPollingController";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import type { BuildLogPreviewer } from "../../ui/BuildLogPreviewer";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import { NodeTreeItem } from "../../tree/TreeItems";
import type { BuildTreeItem, JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";
import { formatActionError, getOpenUrl, getTreeItemLabel } from "../CommandUtils";
import { promptForParameters } from "../../ui/ParameterPrompts";

export async function triggerBuild(
  dataService: JenkinsDataService,
  queuedBuildWaiter: QueuedBuildWaiter,
  refreshHost: BuildCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to trigger.");
    return;
  }

  const label = getTreeItemLabel(item);
  let parameters: JobParameter[] = [];
  let useParameters = false;
  let allowEmptyParams = false;

  try {
    parameters = await dataService.getJobParameters(item.environment, item.jobUrl);
  } catch (error) {
    const buildWithDefaultsLabel = "Try default parameters";
    const buildWithoutParametersLabel = "Run without parameters";
    const decision = await vscode.window.showWarningMessage(
      `Unable to load parameters for ${label}: ${formatActionError(
        error
      )}. Choose how to trigger the build.`,
      buildWithDefaultsLabel,
      buildWithoutParametersLabel,
      "Cancel"
    );
    if (!decision || decision === "Cancel") {
      return;
    }
    const useParametersByChoice: Record<string, boolean> = {
      [buildWithDefaultsLabel]: true,
      [buildWithoutParametersLabel]: false
    };
    useParameters = useParametersByChoice[decision] ?? false;
    allowEmptyParams = useParameters;
  }

  let payload: URLSearchParams | undefined;
  if (parameters.length > 0) {
    payload = await promptForParameters(parameters);
    if (!payload) {
      return;
    }
    useParameters = true;
  }

  try {
    const result = useParameters
      ? await dataService.triggerBuildWithParameters(item.environment, item.jobUrl, payload, {
          allowEmptyParams
        })
      : await dataService.triggerBuild(item.environment, item.jobUrl);
    const message = result.queueLocation
      ? `Triggered build for ${label}. Queued at ${result.queueLocation}`
      : `Triggered build for ${label}.`;
    void vscode.window.showInformationMessage(message);
    void queuedBuildWaiter
      .awaitQueuedBuildStart(item.environment, result.queueLocation)
      .finally(() => {
        refreshHost.refreshEnvironment(item.environment.environmentId);
      });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to trigger build for ${label}: ${formatActionError(error)}`
    );
  }
}

export async function stopBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a running build to stop.");
    return;
  }

  if (!item.isBuilding) {
    void vscode.window.showInformationMessage("That build is not running.");
    return;
  }

  const label = getTreeItemLabel(item);

  try {
    await dataService.stopBuild(item.environment, item.buildUrl);
    void vscode.window.showInformationMessage(`Stopped build ${label}.`);
    refreshHost.refreshEnvironment(item.environment.environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to stop build ${label}: ${formatActionError(error)}`
    );
  }
}

export async function approveInput(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a build to approve input.");
    return;
  }

  const label = getTreeItemLabel(item);
  await handlePendingInputAction({
    dataService,
    environment: item.environment,
    buildUrl: item.buildUrl,
    label,
    action: "approve",
    onRefresh: () => refreshHost.refreshEnvironment(item.environment.environmentId)
  });
}

export async function rejectInput(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a build to reject input.");
    return;
  }

  const label = getTreeItemLabel(item);
  await handlePendingInputAction({
    dataService,
    environment: item.environment,
    buildUrl: item.buildUrl,
    label,
    action: "reject",
    onRefresh: () => refreshHost.refreshEnvironment(item.environment.environmentId)
  });
}


export async function replayBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a build to replay.");
    return;
  }

  const label = getTreeItemLabel(item);

  try {
    await dataService.replayBuild(item.environment, item.buildUrl);
    void vscode.window.showInformationMessage(`Replay requested for ${label}.`);
    refreshHost.refreshEnvironment(item.environment.environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to replay build ${label}: ${formatActionError(error)}`
    );
  }
}

export async function rebuildBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a build to rebuild.");
    return;
  }

  const label = getTreeItemLabel(item);

  try {
    await dataService.rebuildBuild(item.environment, item.buildUrl);
    void vscode.window.showInformationMessage(`Rebuild requested for ${label}.`);
    refreshHost.refreshEnvironment(item.environment.environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to rebuild ${label}: ${formatActionError(error)}`);
  }
}

export async function openInJenkins(
  item?: JobTreeItem | PipelineTreeItem | BuildTreeItem | NodeTreeItem
): Promise<void> {
  if (item instanceof NodeTreeItem && !item.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return;
  }

  const url = getOpenUrl(item);
  if (!url) {
    void vscode.window.showInformationMessage("Select a job, pipeline, build, or node to open.");
    return;
  }

  await vscode.env.openExternal(vscode.Uri.parse(url));
}

export async function showBuildDetails(
  dataService: JenkinsDataService,
  artifactActionHandler: ArtifactActionHandler,
  consoleExporter: BuildConsoleExporter,
  refreshHost: BuildCommandRefreshHost,
  pendingInputProvider: PendingInputActionProvider,
  extensionUri: vscode.Uri,
  item?: BuildTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a build to view details.");
    return;
  }

  try {
    await BuildDetailsPanel.show(
      dataService,
      artifactActionHandler,
      consoleExporter,
      refreshHost,
      pendingInputProvider,
      item.environment,
      item.buildUrl,
      extensionUri,
      getTreeItemLabel(item)
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Unable to open build details: ${formatActionError(error)}`
    );
  }
}

export async function openLastFailedBuild(
  dataService: JenkinsDataService,
  artifactActionHandler: ArtifactActionHandler,
  consoleExporter: BuildConsoleExporter,
  refreshHost: BuildCommandRefreshHost,
  pendingInputProvider: PendingInputActionProvider,
  extensionUri: vscode.Uri,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage(
      "Select a job or pipeline to locate the last failed build."
    );
    return;
  }

  const label = getTreeItemLabel(item);

  try {
    const lastFailed = await dataService.getLastFailedBuild(item.environment, item.jobUrl);
    if (!lastFailed) {
      void vscode.window.showInformationMessage(`No failed builds found for ${label}.`);
      return;
    }
    if (!lastFailed.url) {
      void vscode.window.showInformationMessage(
        `The last failed build for ${label} is missing a URL.`
      );
      return;
    }

    await BuildDetailsPanel.show(
      dataService,
      artifactActionHandler,
      consoleExporter,
      refreshHost,
      pendingInputProvider,
      item.environment,
      lastFailed.url,
      extensionUri,
      `#${lastFailed.number}`
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Unable to open the last failed build for ${label}: ${formatActionError(error)}`
    );
  }
}

export async function previewBuildLog(
  previewer: BuildLogPreviewer,
  item?: BuildTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a build to preview logs.");
    return;
  }

  const label = getTreeItemLabel(item);
  const fileName = `build-${item.buildNumber}.log`;

  try {
    const result = await previewer.preview(item.environment, item.buildUrl, fileName);
    if (result.truncated) {
      void vscode.window.showInformationMessage(
        `Showing last ${result.maxChars.toLocaleString()} characters of console output for ${label}.`
      );
    }
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to preview logs for ${label}: ${formatActionError(error)}`
    );
  }
}

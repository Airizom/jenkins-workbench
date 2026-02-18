import * as vscode from "vscode";
import type {
  BuildParameterPayload,
  JenkinsDataService,
  JobParameter
} from "../../jenkins/JenkinsDataService";
import { BuildDetailsPanel } from "../../panels/BuildDetailsPanel";
import type { PendingInputActionProvider } from "../../panels/buildDetails/BuildDetailsPollingController";
import type { BuildConsoleExporter } from "../../services/BuildConsoleExporter";
import type { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import type { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import { NodeTreeItem } from "../../tree/TreeItems";
import type { BuildTreeItem, JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import type { BuildLogPreviewer } from "../../ui/BuildLogPreviewer";
import { promptForBuildParameters } from "../../ui/BuildParameterPrompts";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import {
  formatActionError,
  getOpenUrl,
  getTreeItemLabel,
  requireSelection,
  withActionErrorMessage
} from "../CommandUtils";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";

type BuildTriggerOptions = {
  payload?: URLSearchParams | BuildParameterPayload;
  useParameters: boolean;
  allowEmptyParams: boolean;
};

function refreshEnvironment(refreshHost: BuildCommandRefreshHost, environmentId: string): void {
  refreshHost.fullEnvironmentRefresh({ environmentId });
}

async function resolveBuildTriggerOptions(
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  selected: JobTreeItem | PipelineTreeItem,
  label: string
): Promise<BuildTriggerOptions | undefined> {
  let parameters: JobParameter[] = [];
  let useParameters = false;
  let allowEmptyParams = false;

  try {
    parameters = await dataService.getJobParameters(selected.environment, selected.jobUrl);
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

    useParameters = decision === buildWithDefaultsLabel;
    allowEmptyParams = useParameters;
  }

  if (parameters.length === 0) {
    return {
      useParameters,
      allowEmptyParams
    };
  }

  const promptResult = await promptForBuildParameters({
    dataService,
    presetStore,
    environment: selected.environment,
    jobUrl: selected.jobUrl,
    jobLabel: label,
    parameters
  });
  if (!promptResult) {
    return;
  }

  return {
    payload: promptResult.payload,
    useParameters: true,
    allowEmptyParams: promptResult.allowEmptyParams
  };
}

async function runBuildAction(
  refreshHost: BuildCommandRefreshHost,
  selected: BuildTreeItem,
  options: {
    errorMessage: string;
    successMessage: string;
    action: (environment: BuildTreeItem["environment"], buildUrl: string) => Promise<void>;
  }
): Promise<void> {
  await withActionErrorMessage(options.errorMessage, async () => {
    await options.action(selected.environment, selected.buildUrl);
    void vscode.window.showInformationMessage(options.successMessage);
    refreshEnvironment(refreshHost, selected.environment.environmentId);
  });
}

async function runPendingInputAction(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  selected: BuildTreeItem,
  action: "approve" | "reject"
): Promise<void> {
  await handlePendingInputAction({
    dataService,
    environment: selected.environment,
    buildUrl: selected.buildUrl,
    label: getTreeItemLabel(selected),
    action,
    onRefresh: () => {
      refreshEnvironment(refreshHost, selected.environment.environmentId);
    }
  });
}

export async function triggerBuild(
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  queuedBuildWaiter: QueuedBuildWaiter,
  refreshHost: BuildCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a job or pipeline to trigger.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  const triggerOptions = await resolveBuildTriggerOptions(
    dataService,
    presetStore,
    selected,
    label
  );
  if (!triggerOptions) {
    return;
  }

  await withActionErrorMessage(`Failed to trigger build for ${label}`, async () => {
    const result = triggerOptions.useParameters
      ? await dataService.triggerBuildWithParameters(
          selected.environment,
          selected.jobUrl,
          triggerOptions.payload,
          {
            allowEmptyParams: triggerOptions.allowEmptyParams
          }
        )
      : await dataService.triggerBuild(selected.environment, selected.jobUrl);
    const message = result.queueLocation
      ? `Triggered build for ${label}. Queued at ${result.queueLocation}`
      : `Triggered build for ${label}.`;
    void vscode.window.showInformationMessage(message);
    void queuedBuildWaiter
      .awaitQueuedBuildStart(selected.environment, result.queueLocation)
      .finally(() => {
        refreshEnvironment(refreshHost, selected.environment.environmentId);
      });
  });
}

export async function stopBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a running build to stop.");
  if (!selected) {
    return;
  }

  if (!selected.isBuilding) {
    void vscode.window.showInformationMessage("That build is not running.");
    return;
  }

  const label = getTreeItemLabel(selected);
  await runBuildAction(refreshHost, selected, {
    errorMessage: `Failed to stop build ${label}`,
    successMessage: `Stopped build ${label}.`,
    action: (environment, buildUrl) => dataService.stopBuild(environment, buildUrl)
  });
}

export async function approveInput(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to approve input.");
  if (!selected) {
    return;
  }

  await runPendingInputAction(dataService, refreshHost, selected, "approve");
}

export async function rejectInput(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to reject input.");
  if (!selected) {
    return;
  }

  await runPendingInputAction(dataService, refreshHost, selected, "reject");
}

export async function replayBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to replay.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  await runBuildAction(refreshHost, selected, {
    errorMessage: `Failed to replay build ${label}`,
    successMessage: `Replay requested for ${label}.`,
    action: (environment, buildUrl) => dataService.replayBuild(environment, buildUrl)
  });
}

export async function rebuildBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to rebuild.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  await runBuildAction(refreshHost, selected, {
    errorMessage: `Failed to rebuild ${label}`,
    successMessage: `Rebuild requested for ${label}.`,
    action: (environment, buildUrl) => dataService.rebuildBuild(environment, buildUrl)
  });
}

export async function openInJenkins(
  item?: JobTreeItem | PipelineTreeItem | BuildTreeItem | NodeTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a job, pipeline, build, or node to open.");
  if (!selected) {
    return;
  }

  if (selected instanceof NodeTreeItem && !selected.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return;
  }

  const url = getOpenUrl(selected);
  if (!url) {
    void vscode.window.showInformationMessage("Select a job, pipeline, build, or node to open.");
    return;
  }

  await openExternalHttpUrlWithWarning(url, {
    targetLabel: "Jenkins URL"
  });
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
  const selected = requireSelection(item, "Select a build to view details.");
  if (!selected) {
    return;
  }

  await withActionErrorMessage("Unable to open build details", async () => {
    await BuildDetailsPanel.show({
      dataService,
      artifactActionHandler,
      consoleExporter,
      refreshHost,
      pendingInputProvider,
      environment: selected.environment,
      buildUrl: selected.buildUrl,
      extensionUri,
      label: getTreeItemLabel(selected)
    });
  });
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
  const selected = requireSelection(
    item,
    "Select a job or pipeline to locate the last failed build."
  );
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  await withActionErrorMessage(`Unable to open the last failed build for ${label}`, async () => {
    const lastFailed = await dataService.getLastFailedBuild(selected.environment, selected.jobUrl);
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

    await BuildDetailsPanel.show({
      dataService,
      artifactActionHandler,
      consoleExporter,
      refreshHost,
      pendingInputProvider,
      environment: selected.environment,
      buildUrl: lastFailed.url,
      extensionUri,
      label: `#${lastFailed.number}`
    });
  });
}

export async function previewBuildLog(
  previewer: BuildLogPreviewer,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to preview logs.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  const fileName = `build-${selected.buildNumber}.log`;

  await withActionErrorMessage(`Failed to preview logs for ${label}`, async () => {
    const result = await previewer.preview(selected.environment, selected.buildUrl, fileName);
    if (result.truncated) {
      void vscode.window.showInformationMessage(
        `Showing last ${result.maxChars.toLocaleString()} characters of console output for ${label}.`
      );
    }
  });
}

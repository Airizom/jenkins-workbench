import * as vscode from "vscode";
import type {
  BuildParameterPayload,
  JenkinsDataService,
  JobParameter
} from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { parseBuildUrl } from "../../jenkins/urls";
import type { BuildComparePanelLauncher } from "../../panels/BuildComparePanelLauncher";
import type { BuildDetailsPanelLauncher } from "../../panels/BuildDetailsPanelLauncher";
import type { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import type { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import { NodeTreeItem } from "../../tree/TreeItems";
import type { BuildTreeItem, JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
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
import type { ReplayBuildWorkflow } from "./ReplayBuildWorkflow";

type BuildTriggerOptions = {
  payload?: URLSearchParams | BuildParameterPayload;
  useParameters: boolean;
  allowEmptyParams: boolean;
};

export interface JenkinsJobTarget {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
}

export interface TriggerBuildForTargetOptions {
  onQueuedBuildWaitSettled?: () => Promise<unknown> | undefined;
}

function refreshEnvironment(refreshHost: BuildCommandRefreshHost, environmentId: string): void {
  refreshHost.fullEnvironmentRefresh({ environmentId });
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

function getSelectedBuildLabel(selected: BuildTreeItem): string {
  return getTreeItemLabel(selected);
}

function createBuildActionConfig(
  label: string,
  verb: string,
  successMessage: string,
  action: (environment: BuildTreeItem["environment"], buildUrl: string) => Promise<void>
): {
  errorMessage: string;
  successMessage: string;
  action: (environment: BuildTreeItem["environment"], buildUrl: string) => Promise<void>;
} {
  return {
    errorMessage: `Failed to ${verb} ${label}`,
    successMessage,
    action
  };
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

  await triggerBuildForTarget(dataService, presetStore, queuedBuildWaiter, refreshHost, {
    environment: selected.environment,
    jobUrl: selected.jobUrl,
    label: getTreeItemLabel(selected)
  });
}

export async function triggerBuildForTarget(
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  queuedBuildWaiter: QueuedBuildWaiter,
  refreshHost: BuildCommandRefreshHost,
  target: JenkinsJobTarget,
  options?: TriggerBuildForTargetOptions
): Promise<void> {
  const triggerOptions = await resolveBuildTriggerOptionsForTarget(
    dataService,
    presetStore,
    target
  );
  if (!triggerOptions) {
    return;
  }

  await withActionErrorMessage(`Failed to trigger build for ${target.label}`, async () => {
    const result = triggerOptions.useParameters
      ? await dataService.triggerBuildWithParameters(
          target.environment,
          target.jobUrl,
          triggerOptions.payload,
          {
            allowEmptyParams: triggerOptions.allowEmptyParams
          }
        )
      : await dataService.triggerBuild(target.environment, target.jobUrl);
    const message = result.queueLocation
      ? `Triggered build for ${target.label}. Queued at ${result.queueLocation}`
      : `Triggered build for ${target.label}.`;
    void vscode.window.showInformationMessage(message);
    void waitForQueuedBuildAndRefresh(
      queuedBuildWaiter,
      refreshHost,
      target,
      result.queueLocation,
      options?.onQueuedBuildWaitSettled
    ).catch((error) => {
      console.warn(`Failed to refresh queued build state for ${target.label}.`, error);
    });
  });
}

async function waitForQueuedBuildAndRefresh(
  queuedBuildWaiter: QueuedBuildWaiter,
  refreshHost: BuildCommandRefreshHost,
  target: JenkinsJobTarget,
  queueLocation: string | undefined,
  onQueuedBuildWaitSettled?: () => Promise<unknown> | undefined
): Promise<void> {
  try {
    await queuedBuildWaiter.awaitQueuedBuildStart(target.environment, queueLocation);
  } finally {
    refreshEnvironment(refreshHost, target.environment.environmentId);
    await onQueuedBuildWaitSettled?.();
  }
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

  const label = getSelectedBuildLabel(selected);
  await runBuildAction(
    refreshHost,
    selected,
    createBuildActionConfig(
      label,
      "stop build",
      `Stopped build ${label}.`,
      (environment, buildUrl) => dataService.stopBuild(environment, buildUrl)
    )
  );
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
  workflow: ReplayBuildWorkflow,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to replay.");
  if (!selected) {
    return;
  }

  await workflow.openReplay({
    environment: selected.environment,
    buildUrl: selected.buildUrl,
    label: getTreeItemLabel(selected)
  });
}

export async function quickReplayBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to replay.");
  if (!selected) {
    return;
  }

  const label = getSelectedBuildLabel(selected);
  await runBuildAction(
    refreshHost,
    selected,
    createBuildActionConfig(
      label,
      "replay build",
      `Replay requested for ${label}.`,
      (environment, buildUrl) => dataService.quickReplayBuild(environment, buildUrl)
    )
  );
}

export async function runReplayDraft(
  workflow: ReplayBuildWorkflow,
  refreshHost: BuildCommandRefreshHost,
  uri?: vscode.Uri
): Promise<void> {
  await workflow.runDraft(refreshHost, uri);
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

  const label = getSelectedBuildLabel(selected);
  await runBuildAction(
    refreshHost,
    selected,
    createBuildActionConfig(
      label,
      "rebuild",
      `Rebuild requested for ${label}.`,
      (environment, buildUrl) => dataService.rebuildBuild(environment, buildUrl)
    )
  );
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
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to view details.");
  if (!selected) {
    return;
  }

  await withActionErrorMessage("Unable to open build details", async () => {
    await buildDetailsPanelLauncher.show({
      environment: selected.environment,
      buildUrl: selected.buildUrl,
      label: getTreeItemLabel(selected)
    });
  });
}

interface CompareBuildQuickPickItem extends vscode.QuickPickItem {
  buildUrl?: string;
}

const BUILD_COMPARE_FETCH_LIMIT = 40;

export async function compareWithBuild(
  dataService: JenkinsDataService,
  buildComparePanelLauncher: BuildComparePanelLauncher,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a completed build to compare.");
  if (!selected) {
    return;
  }

  if (selected.isBuilding) {
    void vscode.window.showInformationMessage(
      "Build comparison is only available for completed builds."
    );
    return;
  }

  await withActionErrorMessage("Unable to open build comparison", async () => {
    const selectedLabel = getTreeItemLabel(selected);
    const parsed = parseBuildUrl(selected.buildUrl);
    if (!parsed) {
      void vscode.window.showInformationMessage(
        "The selected build URL could not be resolved to its Jenkins job."
      );
      return;
    }

    const builds = await dataService.getBuildsForJob(
      selected.environment,
      parsed.jobUrl,
      BUILD_COMPARE_FETCH_LIMIT,
      {
        detailLevel: "details",
        includeParameters: true,
        bypassCache: true
      }
    );
    const comparableBuilds = builds
      .filter(
        (build) =>
          !build.building && build.url !== selected.buildUrl && build.number < selected.buildNumber
      )
      .sort((left, right) => right.number - left.number);

    if (comparableBuilds.length === 0) {
      void vscode.window.showInformationMessage(
        `No other completed builds were found for ${selectedLabel}.`
      );
      return;
    }

    const baseline = await promptForComparisonBuild(selected, comparableBuilds);
    if (!baseline?.buildUrl) {
      return;
    }

    await buildComparePanelLauncher.show({
      environment: selected.environment,
      baselineBuildUrl: baseline.buildUrl,
      targetBuildUrl: selected.buildUrl,
      label: selectedLabel
    });
  });
}

export async function openLastFailedBuild(
  dataService: JenkinsDataService,
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  const selected = requireSelection(
    item,
    "Select a job or pipeline to locate the last failed build."
  );
  if (!selected) {
    return;
  }

  await openLastFailedBuildForTarget(dataService, buildDetailsPanelLauncher, {
    environment: selected.environment,
    jobUrl: selected.jobUrl,
    label: getTreeItemLabel(selected)
  });
}

async function promptForComparisonBuild(
  selected: BuildTreeItem,
  builds: Array<{
    number: number;
    url: string;
    result?: string;
    timestamp?: number;
    duration?: number;
  }>
): Promise<CompareBuildQuickPickItem | undefined> {
  const quickPick = vscode.window.createQuickPick<CompareBuildQuickPickItem>();
  quickPick.ignoreFocusOut = true;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.title = "Compare With Build";
  quickPick.placeholder = `Choose the baseline build for ${getSelectedBuildLabel(selected)}`;

  const previousBuild = builds.find((build) => build.number < selected.buildNumber);
  const suggestedBuild = previousBuild ? createCompareBuildQuickPickItem(previousBuild) : undefined;
  const recentItems = builds
    .filter((build) => build.url !== previousBuild?.url)
    .map((build) => createCompareBuildQuickPickItem(build));

  quickPick.items = suggestedBuild
    ? [
        { label: "Suggested", kind: vscode.QuickPickItemKind.Separator },
        suggestedBuild,
        { label: "Recent Builds", kind: vscode.QuickPickItemKind.Separator },
        ...recentItems
      ]
    : recentItems;

  if (suggestedBuild) {
    quickPick.activeItems = [suggestedBuild];
    quickPick.selectedItems = [suggestedBuild];
  }

  return new Promise<CompareBuildQuickPickItem | undefined>((resolve) => {
    let settled = false;
    const finish = (value: CompareBuildQuickPickItem | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      accept.dispose();
      hide.dispose();
      quickPick.hide();
      resolve(value);
    };

    const accept = quickPick.onDidAccept(() => {
      const item = quickPick.selectedItems[0];
      finish(item?.buildUrl ? item : undefined);
    });
    const hide = quickPick.onDidHide(() => finish(undefined));

    quickPick.show();
  });
}

function createCompareBuildQuickPickItem(build: {
  number: number;
  url: string;
  result?: string;
  timestamp?: number;
  duration?: number;
}): CompareBuildQuickPickItem {
  return {
    label: `#${build.number}`,
    description: build.result ?? "Unknown",
    detail: [formatComparisonTimestamp(build.timestamp), formatComparisonDuration(build.duration)]
      .filter((part) => part.length > 0)
      .join(" • "),
    buildUrl: build.url
  };
}

function formatComparisonTimestamp(timestamp?: number): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString();
}

function formatComparisonDuration(duration?: number): string {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
    return "";
  }
  const totalSeconds = Math.round(duration / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export async function openLastFailedBuildForTarget(
  dataService: JenkinsDataService,
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  target: JenkinsJobTarget
): Promise<void> {
  await withActionErrorMessage(
    `Unable to open the last failed build for ${target.label}`,
    async () => {
      const lastFailed = await dataService.getLastFailedBuild(target.environment, target.jobUrl);
      if (!lastFailed) {
        void vscode.window.showInformationMessage(`No failed builds found for ${target.label}.`);
        return;
      }
      if (!lastFailed.url) {
        void vscode.window.showInformationMessage(
          `The last failed build for ${target.label} is missing a URL.`
        );
        return;
      }

      await buildDetailsPanelLauncher.show({
        environment: target.environment,
        buildUrl: lastFailed.url,
        label: `#${lastFailed.number}`
      });
    }
  );
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

async function resolveBuildTriggerOptionsForTarget(
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  target: JenkinsJobTarget
): Promise<BuildTriggerOptions | undefined> {
  let parameters: JobParameter[] = [];
  let useParameters = false;
  let allowEmptyParams = false;

  try {
    parameters = await dataService.getJobParameters(target.environment, target.jobUrl);
  } catch (error) {
    const buildWithDefaultsLabel = "Try default parameters";
    const buildWithoutParametersLabel = "Run without parameters";
    const decision = await vscode.window.showWarningMessage(
      `Unable to load parameters for ${target.label}: ${formatActionError(
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
    environment: target.environment,
    jobUrl: target.jobUrl,
    jobLabel: target.label,
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

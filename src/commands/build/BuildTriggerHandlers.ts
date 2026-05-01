import * as vscode from "vscode";
import type {
  BuildParameterPayload,
  JenkinsDataService,
  JobParameter
} from "../../jenkins/JenkinsDataService";
import type { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import type { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import type { JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { promptForBuildParameters } from "../../ui/BuildParameterPrompts";
import {
  formatActionError,
  getTreeItemLabel,
  requireSelection,
  withActionErrorMessage
} from "../CommandUtils";
import { refreshEnvironment } from "./BuildCommandRefresh";
import type { JenkinsJobTarget } from "./BuildCommandTargets";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";

type BuildTriggerOptions = {
  payload?: URLSearchParams | BuildParameterPayload;
  useParameters: boolean;
  allowEmptyParams: boolean;
};

export interface TriggerBuildForTargetOptions {
  onQueuedBuildWaitSettled?: () => Promise<unknown> | undefined;
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

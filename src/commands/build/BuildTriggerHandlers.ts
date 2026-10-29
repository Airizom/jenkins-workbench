import * as vscode from "vscode";
import type {
  BuildParameterPayload,
  JenkinsDataService,
  JobParameter
} from "../../jenkins/JenkinsDataService";
import type {
  BuildFollowUpService,
  PreparedFollow
} from "../../services/buildFollow/BuildFollowUpService";
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

export interface QueuedBuildAnnouncement {
  environmentId: string;
  queueLocation?: string;
  /** Without a trailing period, for example "Triggered build for folder/demo". */
  requestedMessage: string;
  onSettled?: () => Promise<unknown> | undefined;
}

/** Announces a build submitted through the queue API and follows its queue item. */
export function announceQueuedBuild(
  buildFollowUp: BuildFollowUpService,
  refreshHost: BuildCommandRefreshHost,
  prepared: PreparedFollow,
  announcement: QueuedBuildAnnouncement
): void {
  const { queueLocation, requestedMessage } = announcement;
  buildFollowUp.announceAndFollow(prepared, {
    location: queueLocation,
    requestedMessage,
    plainMessage: queueLocation ? `${requestedMessage}. Queued at ${queueLocation}` : undefined,
    refresh: () => refreshEnvironment(refreshHost, announcement.environmentId),
    onSettled: announcement.onSettled
  });
}

export async function triggerBuild(
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  buildFollowUp: BuildFollowUpService,
  refreshHost: BuildCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a job or pipeline to trigger.");
  if (!selected) {
    return;
  }

  await triggerBuildForTarget(dataService, presetStore, buildFollowUp, refreshHost, {
    environment: selected.environment,
    jobUrl: selected.jobUrl,
    label: getTreeItemLabel(selected)
  });
}

export async function triggerBuildForTarget(
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  buildFollowUp: BuildFollowUpService,
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

  const prepared = await buildFollowUp.prepare({
    kind: "queue",
    environment: target.environment,
    jobUrl: target.jobUrl,
    label: target.label
  });
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
    announceQueuedBuild(buildFollowUp, refreshHost, prepared, {
      environmentId: target.environment.environmentId,
      queueLocation: result.queueLocation,
      requestedMessage: `Triggered build for ${target.label}`,
      onSettled: options?.onQueuedBuildWaitSettled
    });
  });
}

async function resolveBuildTriggerOptionsForTarget(
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  target: JenkinsJobTarget
): Promise<BuildTriggerOptions | undefined> {
  let parameters: JobParameter[];

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

    const useParameters = decision === buildWithDefaultsLabel;
    return {
      useParameters,
      allowEmptyParams: useParameters
    };
  }

  if (parameters.length === 0) {
    return {
      useParameters: false,
      allowEmptyParams: false
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

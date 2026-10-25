import type * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { TriggerCauseKind } from "../../services/buildFollow/BuildFollowTypes";
import type { BuildFollowUpService } from "../../services/buildFollow/BuildFollowUpService";
import type { BuildTreeItem } from "../../tree/TreeItems";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";
import { refreshEnvironment } from "./BuildCommandRefresh";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";
import type { ReplayBuildWorkflow } from "./ReplayBuildWorkflow";

interface FollowedBuildActionOptions {
  cause: TriggerCauseKind;
  errorMessage: string;
  /** Without a trailing period, for example "Rebuild requested for #12". */
  requestedMessage: string;
  action: (environment: BuildTreeItem["environment"], buildUrl: string) => Promise<void>;
}

async function runFollowedBuildAction(
  buildFollowUp: BuildFollowUpService,
  refreshHost: BuildCommandRefreshHost,
  selected: BuildTreeItem,
  options: FollowedBuildActionOptions
): Promise<void> {
  await withActionErrorMessage(options.errorMessage, async () => {
    const prepared = await buildFollowUp.prepare({
      kind: "cause",
      environment: selected.environment,
      sourceBuildUrl: selected.buildUrl,
      cause: options.cause,
      jobLabel: selected.jobNameHint
    });
    await options.action(selected.environment, selected.buildUrl);
    buildFollowUp.announceAndFollow(prepared, {
      requestedMessage: options.requestedMessage,
      refresh: () => refreshEnvironment(refreshHost, selected.environment.environmentId)
    });
  });
}

async function runPendingInputAction(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item: BuildTreeItem | undefined,
  action: "approve" | "reject"
): Promise<void> {
  const selected = requireSelection(item, `Select a build to ${action} input.`);
  if (!selected) {
    return;
  }

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

export async function approveInput(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  await runPendingInputAction(dataService, refreshHost, item, "approve");
}

export async function rejectInput(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  await runPendingInputAction(dataService, refreshHost, item, "reject");
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
  buildFollowUp: BuildFollowUpService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to replay.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  await runFollowedBuildAction(buildFollowUp, refreshHost, selected, {
    cause: "replay",
    errorMessage: `Failed to replay build ${label}`,
    requestedMessage: `Replay requested for ${label}`,
    action: (environment, buildUrl) => dataService.quickReplayBuild(environment, buildUrl)
  });
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
  buildFollowUp: BuildFollowUpService,
  refreshHost: BuildCommandRefreshHost,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to rebuild.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  await runFollowedBuildAction(buildFollowUp, refreshHost, selected, {
    cause: "rebuild",
    errorMessage: `Failed to rebuild ${label}`,
    requestedMessage: `Rebuild requested for ${label}`,
    action: (environment, buildUrl) => dataService.rebuildBuild(environment, buildUrl)
  });
}

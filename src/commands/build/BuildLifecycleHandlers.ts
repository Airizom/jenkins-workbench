import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { BuildTreeItem } from "../../tree/TreeItems";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";
import { refreshEnvironment } from "./BuildCommandRefresh";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";
import type { ReplayBuildWorkflow } from "./ReplayBuildWorkflow";

interface BuildActionOptions {
  errorMessage: string;
  successMessage: string;
  action: (environment: BuildTreeItem["environment"], buildUrl: string) => Promise<void>;
}

async function runBuildAction(
  refreshHost: BuildCommandRefreshHost,
  selected: BuildTreeItem,
  options: BuildActionOptions
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
  const confirmLabel = "Stop Build";
  const confirmation = await vscode.window.showWarningMessage(
    `Stop the running build ${label}?`,
    { modal: true },
    confirmLabel
  );
  if (confirmation !== confirmLabel) {
    return;
  }

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

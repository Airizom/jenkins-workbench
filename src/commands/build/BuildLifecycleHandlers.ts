import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { BuildTreeItem } from "../../tree/TreeItems";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";
import { refreshEnvironment } from "./BuildCommandRefresh";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";
import type { ReplayBuildWorkflow } from "./ReplayBuildWorkflow";

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

  const label = getTreeItemLabel(selected);
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

  const label = getTreeItemLabel(selected);
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

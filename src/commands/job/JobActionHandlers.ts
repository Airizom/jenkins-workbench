import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { parseJobUrl } from "../../jenkins/urls";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";
import {
  updateJobMetadataOnRename,
  removeJobMetadataOnDelete
} from "./JobMetadataCoordinator";
import { getJobNameValidationError } from "./JobNameValidation";
import type { JobCommandRefreshHost } from "./JobCommandTypes";

export interface JobActionDependencies {
  dataService: JenkinsDataService;
  pinStore: JenkinsPinStore;
  watchStore: JenkinsWatchStore;
  refreshHost: JobCommandRefreshHost;
}

function refreshEnvironment(deps: JobActionDependencies, environmentId: string): void {
  deps.dataService.clearCacheForEnvironment(environmentId);
  deps.refreshHost.refreshEnvironment(environmentId);
}

export async function enableJob(
  deps: JobActionDependencies,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to enable.");
    return;
  }

  const label = getTreeItemLabel(item);
  const environmentId = item.environment.environmentId;

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to enable "${label}"?`,
    { modal: true },
    "Enable"
  );
  if (confirm !== "Enable") {
    return;
  }

  try {
    await deps.dataService.enableJob(item.environment, item.jobUrl);
    void vscode.window.showInformationMessage(`Enabled "${label}".`);
    refreshEnvironment(deps, environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to enable "${label}": ${formatActionError(error)}`);
  }
}

export async function disableJob(
  deps: JobActionDependencies,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to disable.");
    return;
  }

  const label = getTreeItemLabel(item);
  const environmentId = item.environment.environmentId;

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to disable "${label}"? Disabled jobs cannot be built until re-enabled.`,
    { modal: true },
    "Disable"
  );
  if (confirm !== "Disable") {
    return;
  }

  try {
    await deps.dataService.disableJob(item.environment, item.jobUrl);
    void vscode.window.showInformationMessage(`Disabled "${label}".`);
    refreshEnvironment(deps, environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to disable "${label}": ${formatActionError(error)}`
    );
  }
}

export async function renameJob(
  deps: JobActionDependencies,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to rename.");
    return;
  }

  const label = getTreeItemLabel(item);
  const environmentId = item.environment.environmentId;

  const newName = await vscode.window.showInputBox({
    prompt: `Enter a new name for "${label}"`,
    value: label,
    validateInput: (value) => getJobNameValidationError(value)
  });

  if (!newName || newName === label) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to rename "${label}" to "${newName}"?`,
    { modal: true },
    "Rename"
  );
  if (confirm !== "Rename") {
    return;
  }

  try {
    const { newUrl } = await deps.dataService.renameJob(item.environment, item.jobUrl, newName);

    await updateJobMetadataOnRename(
      { pinStore: deps.pinStore, watchStore: deps.watchStore },
      {
        scope: item.environment.scope,
        environmentId,
        jobUrl: item.jobUrl
      },
      newUrl,
      newName
    );

    void vscode.window.showInformationMessage(`Renamed "${label}" to "${newName}".`);
    refreshEnvironment(deps, environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to rename "${label}": ${formatActionError(error)}`);
  }
}

export async function deleteJob(
  deps: JobActionDependencies,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to delete.");
    return;
  }

  const label = getTreeItemLabel(item);
  const environmentId = item.environment.environmentId;

  const typedName = await vscode.window.showInputBox({
    prompt: `Type "${label}" to confirm deletion. This action cannot be undone!`,
    placeHolder: label,
    validateInput: (value) => {
      if (value !== label) {
        return `Please type the exact job name "${label}" to confirm.`;
      }
      return undefined;
    }
  });

  if (typedName !== label) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `FINAL CONFIRMATION: Delete "${label}" permanently? This cannot be undone!`,
    { modal: true },
    "Delete Permanently"
  );
  if (confirm !== "Delete Permanently") {
    return;
  }

  try {
    await deps.dataService.deleteJob(item.environment, item.jobUrl);

    await removeJobMetadataOnDelete(
      { pinStore: deps.pinStore, watchStore: deps.watchStore },
      {
        scope: item.environment.scope,
        environmentId,
        jobUrl: item.jobUrl
      }
    );

    void vscode.window.showInformationMessage(`Deleted "${label}".`);
    refreshEnvironment(deps, environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to delete "${label}": ${formatActionError(error)}`);
  }
}

export async function copyJob(
  deps: JobActionDependencies,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to copy.");
    return;
  }

  const label = getTreeItemLabel(item);
  const environmentId = item.environment.environmentId;
  const parsed = parseJobUrl(item.jobUrl);

  if (!parsed) {
    void vscode.window.showErrorMessage(`Unable to parse job URL for "${label}".`);
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: `Enter a name for the copy of "${label}"`,
    value: `${label}-copy`,
    validateInput: (value) => getJobNameValidationError(value)
  });

  if (!newName) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Create a copy of "${label}" named "${newName}"?`,
    { modal: true },
    "Copy"
  );
  if (confirm !== "Copy") {
    return;
  }

  try {
    const { newUrl } = await deps.dataService.copyJob(
      item.environment,
      parsed.parentUrl,
      parsed.jobName,
      newName
    );

    void vscode.window.showInformationMessage(
      `Copied "${label}" to "${newName}".${newUrl ? ` New job URL: ${newUrl}` : ""}`
    );
    refreshEnvironment(deps, environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to copy "${label}": ${formatActionError(error)}`);
  }
}

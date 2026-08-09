import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { parseJobUrl } from "../../jenkins/urls";
import type { JenkinsDiagnosticProfileBindingStore } from "../../storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { JenkinsFolderTreeItem, JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import {
  formatActionError,
  getTreeItemLabel,
  requireSelection,
  withActionErrorMessage
} from "../CommandUtils";
import { removeJobMetadataOnDelete, updateJobMetadataOnRename } from "./JobMetadataCoordinator";
import { getJobNameValidationError } from "./JobNameValidation";
import type { JobNewItemTargetResolver, JobNewItemTreeTarget } from "./JobNewItemTargetResolver";
import type { JobNewItemWorkflow } from "./JobNewItemWorkflow";

export interface JobActionDependencies {
  bindingStore: JenkinsDiagnosticProfileBindingStore;
  dataService: JenkinsDataService;
  newItemTargetResolver: JobNewItemTargetResolver;
  newItemWorkflow: JobNewItemWorkflow;
  presetStore: JenkinsParameterPresetStore;
  pinStore: JenkinsPinStore;
  watchStore: JenkinsWatchStore;
  refreshHost: EnvironmentScopedRefreshHost;
}

type JobActionTreeItem = JobTreeItem | PipelineTreeItem;

interface JobSelectionContext {
  selected: JobActionTreeItem;
  label: string;
  environmentId: string;
}

interface JobStateActionDefinition {
  verb: "enable" | "disable";
  actionLabel: "Enable" | "Disable";
  successVerb: "Enabled" | "Disabled";
  confirmationDetail?: string;
  operation: "enableJob" | "disableJob";
}

function refreshEnvironment(deps: JobActionDependencies, environmentId: string): void {
  deps.refreshHost.fullEnvironmentRefresh({ environmentId });
}

function getJobSelectionContext(
  item: JobActionTreeItem | undefined,
  missingSelectionMessage: string
): JobSelectionContext | undefined {
  const selected = requireSelection(item, missingSelectionMessage);
  if (!selected) {
    return undefined;
  }

  return {
    selected,
    label: getTreeItemLabel(selected),
    environmentId: selected.environment.environmentId
  };
}

async function confirmModalAction(prompt: string, actionLabel: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(prompt, { modal: true }, actionLabel);
  return choice === actionLabel;
}

function getMetadataStores(deps: JobActionDependencies): {
  bindingStore: JenkinsDiagnosticProfileBindingStore;
  presetStore: JenkinsParameterPresetStore;
  pinStore: JenkinsPinStore;
  watchStore: JenkinsWatchStore;
} {
  return {
    bindingStore: deps.bindingStore,
    presetStore: deps.presetStore,
    pinStore: deps.pinStore,
    watchStore: deps.watchStore
  };
}

function showMetadataFailureWarning(
  successMessage: string,
  metadataAction: "updated" | "removed",
  failures: readonly unknown[]
): boolean {
  if (failures.length === 0) {
    return false;
  }

  const details = failures.map(formatActionError).join("; ");
  void vscode.window.showWarningMessage(
    `${successMessage}, but some local Jenkins metadata could not be ${metadataAction}: ${details}`
  );
  return true;
}

async function runJobActionWithRefresh(
  deps: JobActionDependencies,
  context: JobSelectionContext,
  errorMessage: string,
  action: () => Promise<void>
): Promise<void> {
  await withActionErrorMessage(errorMessage, async () => {
    await action();
    refreshEnvironment(deps, context.environmentId);
  });
}

async function runJobStateAction(
  deps: JobActionDependencies,
  item: JobActionTreeItem | undefined,
  definition: JobStateActionDefinition
): Promise<void> {
  const context = getJobSelectionContext(item, `Select a job or pipeline to ${definition.verb}.`);
  if (!context) {
    return;
  }

  const confirmationDetail = definition.confirmationDetail
    ? ` ${definition.confirmationDetail}`
    : "";
  const confirmed = await confirmModalAction(
    `Are you sure you want to ${definition.verb} "${context.label}"?${confirmationDetail}`,
    definition.actionLabel
  );
  if (!confirmed) {
    return;
  }

  await runJobActionWithRefresh(
    deps,
    context,
    `Failed to ${definition.verb} "${context.label}"`,
    async () => {
      await deps.dataService[definition.operation](
        context.selected.environment,
        context.selected.jobUrl
      );
      void vscode.window.showInformationMessage(`${definition.successVerb} "${context.label}".`);
    }
  );
}

export async function newItem(
  deps: JobActionDependencies,
  item?: JobNewItemTreeTarget
): Promise<void> {
  const target = item
    ? deps.newItemTargetResolver.resolveFromTreeItem(item)
    : await deps.newItemTargetResolver.resolveFromEnvironmentPicker();
  if (!target) {
    return;
  }

  await deps.newItemWorkflow.run(target);
}

export async function scanMultibranch(
  deps: JobActionDependencies,
  item?: JenkinsFolderTreeItem
): Promise<void> {
  if (!item || item.folderKind !== "multibranch") {
    void vscode.window.showInformationMessage("Select a multibranch folder to scan.");
    return;
  }

  const label = getTreeItemLabel(item);
  const environmentId = item.environment.environmentId;

  await withActionErrorMessage(`Failed to scan ${label}`, async () => {
    const result = await deps.dataService.scanMultibranch(item.environment, item.folderUrl);
    const message = result.queueLocation
      ? `Scan started for ${label}. Queued at ${result.queueLocation}`
      : `Scan started for ${label}.`;
    void vscode.window.showInformationMessage(message);
    refreshEnvironment(deps, environmentId);
  });
}

export async function enableJob(
  deps: JobActionDependencies,
  item?: JobActionTreeItem
): Promise<void> {
  await runJobStateAction(deps, item, {
    verb: "enable",
    actionLabel: "Enable",
    successVerb: "Enabled",
    operation: "enableJob"
  });
}

export async function disableJob(
  deps: JobActionDependencies,
  item?: JobActionTreeItem
): Promise<void> {
  await runJobStateAction(deps, item, {
    verb: "disable",
    actionLabel: "Disable",
    successVerb: "Disabled",
    confirmationDetail: "Disabled jobs cannot be built until re-enabled.",
    operation: "disableJob"
  });
}

export async function renameJob(
  deps: JobActionDependencies,
  item?: JobActionTreeItem
): Promise<void> {
  const context = getJobSelectionContext(item, "Select a job or pipeline to rename.");
  if (!context) {
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: `Enter a new name for "${context.label}"`,
    value: context.label,
    validateInput: (value) => getJobNameValidationError(value)
  });

  if (!newName || newName === context.label) {
    return;
  }

  const confirmed = await confirmModalAction(
    `Are you sure you want to rename "${context.label}" to "${newName}"?`,
    "Rename"
  );
  if (!confirmed) {
    return;
  }

  await withActionErrorMessage(`Failed to rename "${context.label}"`, async () => {
    const { newUrl } = await deps.dataService.renameJob(
      context.selected.environment,
      context.selected.jobUrl,
      newName
    );
    refreshEnvironment(deps, context.environmentId);

    const metadataResult = await updateJobMetadataOnRename(
      getMetadataStores(deps),
      {
        scope: context.selected.environment.scope,
        environmentId: context.environmentId,
        jobUrl: context.selected.jobUrl
      },
      newUrl,
      newName
    );

    const successMessage = `Renamed "${context.label}" to "${newName}"`;
    if (!showMetadataFailureWarning(successMessage, "updated", metadataResult.failures)) {
      void vscode.window.showInformationMessage(`${successMessage}.`);
    }
  });
}

export async function deleteJob(
  deps: JobActionDependencies,
  item?: JobActionTreeItem
): Promise<void> {
  const context = getJobSelectionContext(item, "Select a job or pipeline to delete.");
  if (!context) {
    return;
  }

  const typedName = await vscode.window.showInputBox({
    prompt: `Type "${context.label}" to confirm deletion. This action cannot be undone!`,
    placeHolder: context.label,
    validateInput: (value) => {
      if (value !== context.label) {
        return `Please type the exact job name "${context.label}" to confirm.`;
      }
      return undefined;
    }
  });

  if (typedName !== context.label) {
    return;
  }

  const confirmed = await confirmModalAction(
    `FINAL CONFIRMATION: Delete "${context.label}" permanently? This cannot be undone!`,
    "Delete Permanently"
  );
  if (!confirmed) {
    return;
  }

  await withActionErrorMessage(`Failed to delete "${context.label}"`, async () => {
    await deps.dataService.deleteJob(context.selected.environment, context.selected.jobUrl);
    refreshEnvironment(deps, context.environmentId);

    const metadataResult = await removeJobMetadataOnDelete(getMetadataStores(deps), {
      scope: context.selected.environment.scope,
      environmentId: context.environmentId,
      jobUrl: context.selected.jobUrl
    });

    const successMessage = `Deleted "${context.label}"`;
    if (!showMetadataFailureWarning(successMessage, "removed", metadataResult.failures)) {
      void vscode.window.showInformationMessage(`${successMessage}.`);
    }
  });
}

export async function copyJob(
  deps: JobActionDependencies,
  item?: JobActionTreeItem
): Promise<void> {
  const context = getJobSelectionContext(item, "Select a job or pipeline to copy.");
  if (!context) {
    return;
  }

  const parsed = parseJobUrl(context.selected.jobUrl);

  if (!parsed) {
    void vscode.window.showErrorMessage(`Unable to parse job URL for "${context.label}".`);
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: `Enter a name for the copy of "${context.label}"`,
    value: `${context.label}-copy`,
    validateInput: (value) => getJobNameValidationError(value)
  });

  if (!newName) {
    return;
  }

  const confirmed = await confirmModalAction(
    `Create a copy of "${context.label}" named "${newName}"?`,
    "Copy"
  );
  if (!confirmed) {
    return;
  }

  await runJobActionWithRefresh(deps, context, `Failed to copy "${context.label}"`, async () => {
    const { newUrl } = await deps.dataService.copyJob(
      context.selected.environment,
      parsed.parentUrl,
      parsed.jobName,
      newName
    );

    void vscode.window.showInformationMessage(
      `Copied "${context.label}" to "${newName}".${newUrl ? ` New job URL: ${newUrl}` : ""}`
    );
  });
}

import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { canonicalizeJobUrlForEnvironment } from "../../jenkins/urls";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type {
  JobTreeItem,
  PinnedJobsFolderTreeItem,
  PipelineTreeItem,
  StalePinnedJobTreeItem
} from "../../tree/TreeItems";
import {
  addJobScopedState,
  createEnvironmentRefreshCallback,
  getCanonicalTreeJobUrl,
  getJobTreeItemKind,
  getTreeItemLabel,
  getTreeJobUrlAliases,
  removeJobScopedState,
  withActionErrorMessage
} from "../CommandUtils";

async function applyToJobUrlAliases(
  item: JobTreeItem | PipelineTreeItem | StalePinnedJobTreeItem,
  operation: (jobUrl: string) => Promise<boolean>
): Promise<boolean> {
  const results = await Promise.all(getTreeJobUrlAliases(item).map(operation));
  return results.some(Boolean);
}

async function isPinnedJob(
  pinStore: JenkinsPinStore,
  item: JobTreeItem | PipelineTreeItem
): Promise<boolean> {
  return applyToJobUrlAliases(item, (jobUrl) =>
    pinStore.isPinned(item.environment.scope, item.environment.environmentId, jobUrl)
  );
}

async function removePinnedJob(
  pinStore: JenkinsPinStore,
  item: JobTreeItem | PipelineTreeItem | StalePinnedJobTreeItem
): Promise<boolean> {
  return applyToJobUrlAliases(item, (jobUrl) =>
    pinStore.removePin(item.environment.scope, item.environment.environmentId, jobUrl)
  );
}

export async function pinJob(
  pinStore: JenkinsPinStore,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  await addJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to pin.",
    getLabel: getTreeItemLabel,
    alreadyPresentMessage: (label) => `${label} is already pinned.`,
    addedMessage: (label) => `Pinned ${label}.`,
    isPresent: async (selected) => isPinnedJob(pinStore, selected),
    add: async (selected, label) =>
      pinStore.addPin(selected.environment.scope, {
        environmentId: selected.environment.environmentId,
        jobUrl: getCanonicalTreeJobUrl(selected),
        jobName: label,
        jobKind: getJobTreeItemKind(selected)
      }),
    refreshEnvironment: createEnvironmentRefreshCallback(refreshHost)
  });
}

export async function unpinJob(
  pinStore: JenkinsPinStore,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: JobTreeItem | PipelineTreeItem | StalePinnedJobTreeItem
): Promise<void> {
  await removeJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to unpin.",
    getLabel: getTreeItemLabel,
    missingStateMessage: (label) => `${label} is not currently pinned.`,
    removedMessage: (label) => `Unpinned ${label}.`,
    remove: async (selected) => removePinnedJob(pinStore, selected),
    refreshEnvironment: createEnvironmentRefreshCallback(refreshHost)
  });
}

export async function removeMissingPins(
  dataService: JenkinsDataService,
  pinStore: JenkinsPinStore,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: PinnedJobsFolderTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select the Pinned section to remove missing pins.");
    return;
  }

  await withActionErrorMessage("Failed to remove missing pins", async () => {
    const jobs = await dataService.getAllJobsForEnvironment(item.environment, {
      mode: "refresh"
    });
    const validUrls = new Set<string>();
    for (const job of jobs) {
      validUrls.add(job.url);
      const canonicalJobUrl = canonicalizeJobUrlForEnvironment(item.environment.url, job.url);
      if (canonicalJobUrl) {
        validUrls.add(canonicalJobUrl);
      }
    }
    const removed = await pinStore.removeMissingPins(
      item.environment.scope,
      item.environment.environmentId,
      validUrls
    );

    void vscode.window.showInformationMessage(
      removed > 0 ? `Removed ${removed} missing pinned item(s).` : "No missing pinned items found."
    );
    refreshHost.fullEnvironmentRefresh({ environmentId: item.environment.environmentId });
  });
}

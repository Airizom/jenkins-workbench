import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { canonicalizeJobUrlForEnvironment } from "../../jenkins/urls";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import {
  type JobTreeItem,
  type PinnedJobsFolderTreeItem,
  PipelineTreeItem,
  type StalePinnedJobTreeItem
} from "../../tree/TreeItems";
import {
  addJobScopedState,
  getTreeItemLabel,
  removeJobScopedState,
  withActionErrorMessage
} from "../CommandUtils";
import type { PinCommandRefreshHost } from "./PinCommandTypes";

function getCanonicalJobUrl(item: JobTreeItem | PipelineTreeItem | StalePinnedJobTreeItem): string {
  return canonicalizeJobUrlForEnvironment(item.environment.url, item.jobUrl) ?? item.jobUrl;
}

async function isPinnedJob(
  pinStore: JenkinsPinStore,
  item: JobTreeItem | PipelineTreeItem
): Promise<boolean> {
  const canonicalJobUrl = getCanonicalJobUrl(item);
  const [hasRawPin, hasCanonicalPin] = await Promise.all([
    pinStore.isPinned(item.environment.scope, item.environment.environmentId, item.jobUrl),
    canonicalJobUrl === item.jobUrl
      ? Promise.resolve(false)
      : pinStore.isPinned(item.environment.scope, item.environment.environmentId, canonicalJobUrl)
  ]);

  return hasRawPin || hasCanonicalPin;
}

async function removePinnedJob(
  pinStore: JenkinsPinStore,
  item: JobTreeItem | PipelineTreeItem | StalePinnedJobTreeItem
): Promise<boolean> {
  const canonicalJobUrl = getCanonicalJobUrl(item);
  const [removedRawPin, removedCanonicalPin] = await Promise.all([
    pinStore.removePin(item.environment.scope, item.environment.environmentId, item.jobUrl),
    canonicalJobUrl === item.jobUrl
      ? Promise.resolve(false)
      : pinStore.removePin(item.environment.scope, item.environment.environmentId, canonicalJobUrl)
  ]);

  return removedRawPin || removedCanonicalPin;
}

export async function pinJob(
  pinStore: JenkinsPinStore,
  refreshHost: PinCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  await addJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to pin.",
    getLabel: (selected) => getTreeItemLabel(selected),
    alreadyPresentMessage: (label) => `${label} is already pinned.`,
    addedMessage: (label) => `Pinned ${label}.`,
    isPresent: async (selected) => isPinnedJob(pinStore, selected),
    add: async (selected, label) =>
      pinStore.addPin(selected.environment.scope, {
        environmentId: selected.environment.environmentId,
        jobUrl: getCanonicalJobUrl(selected),
        jobName: label,
        jobKind: selected instanceof PipelineTreeItem ? "pipeline" : "job"
      }),
    refreshEnvironment: (environmentId) => {
      refreshHost.fullEnvironmentRefresh({ environmentId: environmentId });
    }
  });
}

export async function unpinJob(
  pinStore: JenkinsPinStore,
  refreshHost: PinCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem | StalePinnedJobTreeItem
): Promise<void> {
  await removeJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to unpin.",
    getLabel: (selected) => getTreeItemLabel(selected),
    missingStateMessage: (label) => `${label} is not currently pinned.`,
    removedMessage: (label) => `Unpinned ${label}.`,
    remove: async (selected) => removePinnedJob(pinStore, selected),
    refreshEnvironment: (environmentId) => {
      refreshHost.fullEnvironmentRefresh({ environmentId: environmentId });
    }
  });
}

export async function removeMissingPins(
  dataService: JenkinsDataService,
  pinStore: JenkinsPinStore,
  refreshHost: PinCommandRefreshHost,
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
    const validUrls = new Set(jobs.map((job) => job.url));
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

import { canonicalizeJobUrlForEnvironment } from "../../jenkins/urls";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import { type JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { addJobScopedState, getTreeItemLabel, removeJobScopedState } from "../CommandUtils";
import type { WatchCommandRefreshHost } from "./WatchCommandTypes";

function getCanonicalJobUrl(item: JobTreeItem | PipelineTreeItem): string {
  return canonicalizeJobUrlForEnvironment(item.environment.url, item.jobUrl) ?? item.jobUrl;
}

async function isWatchedJob(
  watchStore: JenkinsWatchStore,
  item: JobTreeItem | PipelineTreeItem
): Promise<boolean> {
  const canonicalJobUrl = getCanonicalJobUrl(item);
  const [hasRawWatch, hasCanonicalWatch] = await Promise.all([
    watchStore.isWatched(item.environment.scope, item.environment.environmentId, item.jobUrl),
    canonicalJobUrl === item.jobUrl
      ? Promise.resolve(false)
      : watchStore.isWatched(
          item.environment.scope,
          item.environment.environmentId,
          canonicalJobUrl
        )
  ]);

  return hasRawWatch || hasCanonicalWatch;
}

async function removeWatchedJob(
  watchStore: JenkinsWatchStore,
  item: JobTreeItem | PipelineTreeItem
): Promise<boolean> {
  const canonicalJobUrl = getCanonicalJobUrl(item);
  const [removedRawWatch, removedCanonicalWatch] = await Promise.all([
    watchStore.removeWatch(item.environment.scope, item.environment.environmentId, item.jobUrl),
    canonicalJobUrl === item.jobUrl
      ? Promise.resolve(false)
      : watchStore.removeWatch(
          item.environment.scope,
          item.environment.environmentId,
          canonicalJobUrl
        )
  ]);

  return removedRawWatch || removedCanonicalWatch;
}

export async function watchJob(
  watchStore: JenkinsWatchStore,
  refreshHost: WatchCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  await addJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to watch.",
    getLabel: (selected) => getTreeItemLabel(selected),
    alreadyPresentMessage: (label) => `${label} is already being watched.`,
    addedMessage: (label) => `Watching ${label}.`,
    isPresent: async (selected) => isWatchedJob(watchStore, selected),
    add: async (selected, label) =>
      watchStore.addWatch(selected.environment.scope, {
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

export async function unwatchJob(
  watchStore: JenkinsWatchStore,
  refreshHost: WatchCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  await removeJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to unwatch.",
    getLabel: (selected) => getTreeItemLabel(selected),
    missingStateMessage: (label) => `${label} is not currently watched.`,
    removedMessage: (label) => `Stopped watching ${label}.`,
    remove: async (selected) => removeWatchedJob(watchStore, selected),
    refreshEnvironment: (environmentId) => {
      refreshHost.fullEnvironmentRefresh({ environmentId: environmentId });
    }
  });
}

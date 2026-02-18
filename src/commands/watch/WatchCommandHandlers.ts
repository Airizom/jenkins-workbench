import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import { type JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { addJobScopedState, getTreeItemLabel, removeJobScopedState } from "../CommandUtils";
import type { WatchCommandRefreshHost } from "./WatchCommandTypes";

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
    isPresent: async (selected) =>
      watchStore.isWatched(
        selected.environment.scope,
        selected.environment.environmentId,
        selected.jobUrl
      ),
    add: async (selected, label) =>
      watchStore.addWatch(selected.environment.scope, {
        environmentId: selected.environment.environmentId,
        jobUrl: selected.jobUrl,
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
    remove: async (selected) =>
      watchStore.removeWatch(
        selected.environment.scope,
        selected.environment.environmentId,
        selected.jobUrl
      ),
    refreshEnvironment: (environmentId) => {
      refreshHost.fullEnvironmentRefresh({ environmentId: environmentId });
    }
  });
}

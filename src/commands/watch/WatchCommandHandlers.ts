import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import {
  addJobScopedState,
  createEnvironmentRefreshCallback,
  getCanonicalTreeJobUrl,
  getJobTreeItemKind,
  getTreeItemLabel,
  getTreeJobUrlAliases,
  removeJobScopedState
} from "../CommandUtils";

async function isWatchedJob(
  watchStore: JenkinsWatchStore,
  item: JobTreeItem | PipelineTreeItem
): Promise<boolean> {
  const watchResults = await Promise.all(
    getTreeJobUrlAliases(item).map((jobUrl) =>
      watchStore.isWatched(item.environment.scope, item.environment.environmentId, jobUrl)
    )
  );

  return watchResults.some(Boolean);
}

async function removeWatchedJob(
  watchStore: JenkinsWatchStore,
  item: JobTreeItem | PipelineTreeItem
): Promise<{ removed: boolean; errors: unknown[] }> {
  const removeResults = await Promise.allSettled(
    getTreeJobUrlAliases(item).map((jobUrl) =>
      watchStore.removeWatch(item.environment.scope, item.environment.environmentId, jobUrl)
    )
  );

  return {
    removed: removeResults.some((result) => result.status === "fulfilled" && result.value),
    errors: removeResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
  };
}

export async function watchJob(
  watchStore: JenkinsWatchStore,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  await addJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to watch.",
    getLabel: getTreeItemLabel,
    alreadyPresentMessage: (label) => `${label} is already being watched.`,
    addedMessage: (label) => `Watching ${label}.`,
    isPresent: async (selected) => isWatchedJob(watchStore, selected),
    add: async (selected, label) =>
      watchStore.addWatch(selected.environment.scope, {
        environmentId: selected.environment.environmentId,
        jobUrl: getCanonicalTreeJobUrl(selected),
        jobName: label,
        jobKind: getJobTreeItemKind(selected)
      }),
    refreshEnvironment: createEnvironmentRefreshCallback(refreshHost)
  });
}

export async function unwatchJob(
  watchStore: JenkinsWatchStore,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  let removalErrors: unknown[] = [];
  await removeJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to unwatch.",
    getLabel: getTreeItemLabel,
    missingStateMessage: (label) => `${label} is not currently watched.`,
    removedMessage: (label) => `Stopped watching ${label}.`,
    remove: async (selected) => {
      const result = await removeWatchedJob(watchStore, selected);
      if (!result.removed && result.errors.length > 0) {
        throw new AggregateError(result.errors, "Failed to remove watch aliases.");
      }
      removalErrors = result.errors;
      return result.removed;
    },
    refreshEnvironment: createEnvironmentRefreshCallback(refreshHost)
  });

  if (removalErrors.length > 0) {
    throw new AggregateError(removalErrors, "Failed to remove all watch aliases.");
  }
}

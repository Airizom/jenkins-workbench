import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import { type JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { addJobScopedState, getTreeItemLabel, removeJobScopedState } from "../CommandUtils";
import type { PinCommandRefreshHost } from "./PinCommandTypes";

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
    isPresent: async (selected) =>
      pinStore.isPinned(
        selected.environment.scope,
        selected.environment.environmentId,
        selected.jobUrl
      ),
    add: async (selected, label) =>
      pinStore.addPin(selected.environment.scope, {
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

export async function unpinJob(
  pinStore: JenkinsPinStore,
  refreshHost: PinCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  await removeJobScopedState({
    item,
    missingSelectionMessage: "Select a job or pipeline to unpin.",
    getLabel: (selected) => getTreeItemLabel(selected),
    missingStateMessage: (label) => `${label} is not currently pinned.`,
    removedMessage: (label) => `Unpinned ${label}.`,
    remove: async (selected) =>
      pinStore.removePin(
        selected.environment.scope,
        selected.environment.environmentId,
        selected.jobUrl
      ),
    refreshEnvironment: (environmentId) => {
      refreshHost.fullEnvironmentRefresh({ environmentId: environmentId });
    }
  });
}

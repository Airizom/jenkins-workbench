import * as vscode from "vscode";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import { type JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel } from "../CommandUtils";
import type { WatchCommandRefreshHost } from "./WatchCommandTypes";

export async function watchJob(
  watchStore: JenkinsWatchStore,
  refreshHost: WatchCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to watch.");
    return;
  }

  const label = getTreeItemLabel(item);
  const isWatched = await watchStore.isWatched(
    item.environment.scope,
    item.environment.environmentId,
    item.jobUrl
  );

  if (isWatched) {
    void vscode.window.showInformationMessage(`${label} is already being watched.`);
    return;
  }

  await watchStore.addWatch(item.environment.scope, {
    environmentId: item.environment.environmentId,
    jobUrl: item.jobUrl,
    jobName: label,
    jobKind: item instanceof PipelineTreeItem ? "pipeline" : "job"
  });

  void vscode.window.showInformationMessage(`Watching ${label}.`);
  refreshHost.refreshEnvironment(item.environment.environmentId);
}

export async function unwatchJob(
  watchStore: JenkinsWatchStore,
  refreshHost: WatchCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to unwatch.");
    return;
  }

  const label = getTreeItemLabel(item);
  const removed = await watchStore.removeWatch(
    item.environment.scope,
    item.environment.environmentId,
    item.jobUrl
  );

  if (!removed) {
    void vscode.window.showInformationMessage(`${label} is not currently watched.`);
    return;
  }

  void vscode.window.showInformationMessage(`Stopped watching ${label}.`);
  refreshHost.refreshEnvironment(item.environment.environmentId);
}

import * as vscode from "vscode";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import { type JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel } from "../build/BuildCommandUtils";
import type { PinCommandRefreshHost } from "./PinCommandTypes";

export async function pinJob(
  pinStore: JenkinsPinStore,
  refreshHost: PinCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to pin.");
    return;
  }

  const label = getTreeItemLabel(item);
  const isPinned = await pinStore.isPinned(
    item.environment.scope,
    item.environment.environmentId,
    item.jobUrl
  );

  if (isPinned) {
    void vscode.window.showInformationMessage(`${label} is already pinned.`);
    return;
  }

  await pinStore.addPin(item.environment.scope, {
    environmentId: item.environment.environmentId,
    jobUrl: item.jobUrl,
    jobName: label,
    jobKind: item instanceof PipelineTreeItem ? "pipeline" : "job"
  });

  void vscode.window.showInformationMessage(`Pinned ${label}.`);
  refreshHost.refreshEnvironment(item.environment.environmentId);
}

export async function unpinJob(
  pinStore: JenkinsPinStore,
  refreshHost: PinCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to unpin.");
    return;
  }

  const label = getTreeItemLabel(item);
  const removed = await pinStore.removePin(
    item.environment.scope,
    item.environment.environmentId,
    item.jobUrl
  );

  if (!removed) {
    void vscode.window.showInformationMessage(`${label} is not currently pinned.`);
    return;
  }

  void vscode.window.showInformationMessage(`Unpinned ${label}.`);
  refreshHost.refreshEnvironment(item.environment.environmentId);
}

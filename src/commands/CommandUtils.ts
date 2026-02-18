import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  BuildTreeItem,
  type JobTreeItem,
  NodeTreeItem,
  type PipelineTreeItem
} from "../tree/TreeItems";
import { formatActionError } from "../formatters/ErrorFormatters";
import { getTreeItemLabel as resolveTreeItemLabel } from "../tree/TreeItemLabels";
export { formatActionError };

export function getOpenUrl(
  item?: JobTreeItem | PipelineTreeItem | BuildTreeItem | NodeTreeItem
): string | undefined {
  if (!item) {
    return undefined;
  }

  if (item instanceof BuildTreeItem) {
    return item.buildUrl;
  }

  if (item instanceof NodeTreeItem) {
    return item.nodeUrl;
  }

  return item.jobUrl;
}

export function getTreeItemLabel(item: vscode.TreeItem): string {
  return resolveTreeItemLabel(item, "item");
}

export function requireSelection<T>(
  item: T | undefined,
  missingSelectionMessage: string
): T | undefined {
  if (!item) {
    void vscode.window.showInformationMessage(missingSelectionMessage);
    return undefined;
  }
  return item;
}

export async function withActionErrorMessage(
  messagePrefix: string,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    void vscode.window.showErrorMessage(`${messagePrefix}: ${formatActionError(error)}`);
  }
}

interface JobScopedStateItem {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
}

interface AddJobScopedStateOptions<T extends JobScopedStateItem> {
  item: T | undefined;
  missingSelectionMessage: string;
  getLabel: (item: T) => string;
  alreadyPresentMessage: (label: string) => string;
  addedMessage: (label: string) => string;
  isPresent: (item: T) => Promise<boolean>;
  add: (item: T, label: string) => Promise<void>;
  refreshEnvironment: (environmentId: string) => void;
}

interface RemoveJobScopedStateOptions<T extends JobScopedStateItem> {
  item: T | undefined;
  missingSelectionMessage: string;
  getLabel: (item: T) => string;
  missingStateMessage: (label: string) => string;
  removedMessage: (label: string) => string;
  remove: (item: T) => Promise<boolean>;
  refreshEnvironment: (environmentId: string) => void;
}

export async function addJobScopedState<T extends JobScopedStateItem>(
  options: AddJobScopedStateOptions<T>
): Promise<void> {
  const item = requireSelection(options.item, options.missingSelectionMessage);
  if (!item) {
    return;
  }

  const label = options.getLabel(item);
  const isPresent = await options.isPresent(item);

  if (isPresent) {
    void vscode.window.showInformationMessage(options.alreadyPresentMessage(label));
    return;
  }

  await options.add(item, label);
  void vscode.window.showInformationMessage(options.addedMessage(label));
  options.refreshEnvironment(item.environment.environmentId);
}

export async function removeJobScopedState<T extends JobScopedStateItem>(
  options: RemoveJobScopedStateOptions<T>
): Promise<void> {
  const item = requireSelection(options.item, options.missingSelectionMessage);
  if (!item) {
    return;
  }

  const label = options.getLabel(item);
  const removed = await options.remove(item);

  if (!removed) {
    void vscode.window.showInformationMessage(options.missingStateMessage(label));
    return;
  }

  void vscode.window.showInformationMessage(options.removedMessage(label));
  options.refreshEnvironment(item.environment.environmentId);
}

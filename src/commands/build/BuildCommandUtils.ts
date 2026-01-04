import type * as vscode from "vscode";
import { BuildActionError } from "../../jenkins/JenkinsDataService";
import { BuildTreeItem, type JobTreeItem, type PipelineTreeItem } from "../../tree/TreeItems";

export function getOpenUrl(
  item?: JobTreeItem | PipelineTreeItem | BuildTreeItem
): string | undefined {
  if (!item) {
    return undefined;
  }

  if (item instanceof BuildTreeItem) {
    return item.buildUrl;
  }

  return item.jobUrl;
}

export function getTreeItemLabel(item: vscode.TreeItem): string {
  if (typeof item.label === "string") {
    return item.label;
  }

  return item.label?.label ?? "item";
}

export function formatActionError(error: unknown): string {
  if (error instanceof BuildActionError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Unexpected error.";
}

import type * as vscode from "vscode";
import { BuildActionError } from "../../jenkins/JenkinsDataService";
import {
  BuildTreeItem,
  type JobTreeItem,
  NodeTreeItem,
  type PipelineTreeItem
} from "../../tree/TreeItems";

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

import type * as vscode from "vscode";
import {
  BuildTreeItem,
  type JobTreeItem,
  NodeTreeItem,
  type PipelineTreeItem
} from "../tree/TreeItems";
export { formatActionError } from "../formatters/ErrorFormatters";

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

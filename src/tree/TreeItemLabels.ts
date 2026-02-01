import type * as vscode from "vscode";

export type TreeItemLabelInput = vscode.TreeItem | string | { label: string } | undefined;

export function resolveTreeItemLabel(input: TreeItemLabelInput): string | undefined {
  if (!input) {
    return undefined;
  }

  if (typeof input === "string") {
    return input;
  }

  const label = input.label;
  if (typeof label === "string") {
    return label;
  }

  return label?.label;
}

export function getTreeItemLabel(input: TreeItemLabelInput, fallback = "item"): string {
  return resolveTreeItemLabel(input) ?? fallback;
}

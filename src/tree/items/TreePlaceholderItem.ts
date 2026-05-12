import * as vscode from "vscode";

const INFO_ICON = new vscode.ThemeIcon("info");
const LOADING_ICON = new vscode.ThemeIcon("sync~spin");
const WARNING_ICON = new vscode.ThemeIcon("warning");

export class PlaceholderTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description?: string,
    public readonly kind: "empty" | "error" | "loading" = "empty"
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "placeholder";
    this.description = description;
    this.tooltip = description ? `${label}\n${description}` : label;
    this.iconPath = resolvePlaceholderIcon(kind);
  }
}

function resolvePlaceholderIcon(kind: "empty" | "error" | "loading"): vscode.ThemeIcon {
  switch (kind) {
    case "error":
      return WARNING_ICON;
    case "loading":
      return LOADING_ICON;
    case "empty":
      return INFO_ICON;
  }
}

import * as vscode from "vscode";

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
    this.iconPath =
      kind === "error"
        ? new vscode.ThemeIcon("warning")
        : kind === "loading"
          ? new vscode.ThemeIcon("sync~spin")
          : new vscode.ThemeIcon("info");
  }
}

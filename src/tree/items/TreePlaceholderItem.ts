import * as vscode from "vscode";
import type { TreeEnvironmentIssueKind } from "../TreeLoadErrors";

const INFO_ICON = new vscode.ThemeIcon("info");
const LOADING_ICON = new vscode.ThemeIcon("sync~spin");
const WARNING_ICON = new vscode.ThemeIcon("warning");

type PlaceholderKind = "empty" | "error" | "loading";

export interface PlaceholderTreeItemOptions {
  command?: vscode.Command;
  icon?: vscode.ThemeIcon;
  hint?: string;
  issue?: TreeEnvironmentIssueKind;
}

export class PlaceholderTreeItem extends vscode.TreeItem {
  public readonly issue?: TreeEnvironmentIssueKind;

  constructor(
    label: string,
    description?: string,
    public readonly kind: PlaceholderKind = "empty",
    options: PlaceholderTreeItemOptions = {}
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "placeholder";
    this.description = description;
    this.issue = options.issue;
    this.command = options.command;
    this.tooltip = [label, description, options.hint].filter(Boolean).join("\n");
    this.iconPath = options.icon ?? resolvePlaceholderIcon(kind);
  }

  // Error placeholders are created deep inside loaders that only know the failing request;
  // the owning environment attaches the retry action once the placeholder reaches the tree.
  attachRetryCommand(command: vscode.Command): void {
    if (this.kind !== "error" || this.command) {
      return;
    }
    this.command = command;
    this.tooltip = `${this.tooltip}\nClick to retry.`;
  }
}

function resolvePlaceholderIcon(kind: PlaceholderKind): vscode.ThemeIcon {
  switch (kind) {
    case "error":
      return WARNING_ICON;
    case "loading":
      return LOADING_ICON;
    case "empty":
      return INFO_ICON;
  }
}

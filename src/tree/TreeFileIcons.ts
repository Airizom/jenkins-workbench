import * as vscode from "vscode";

// Remote files have no local path, but a resourceUri with the right basename is all VS Code
// needs to pick an icon from the user's file icon theme. The private scheme keeps SCM and
// other file decoration providers from matching these entries.
const TREE_FILE_SCHEME = "jenkins-workbench-tree";

export function applyTreeFileIcon(
  item: vscode.TreeItem,
  relativePath: string,
  kind: "file" | "folder"
): void {
  const normalizedPath = relativePath.replace(/^\/+/, "");
  item.resourceUri = vscode.Uri.from({ scheme: TREE_FILE_SCHEME, path: `/${normalizedPath}` });
  item.iconPath = kind === "folder" ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
}

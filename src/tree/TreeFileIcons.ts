import * as vscode from "vscode";

export const TREE_FOLDER_ICON = new vscode.ThemeIcon("folder");
const TREE_FILE_ICON = new vscode.ThemeIcon("file");
const TREE_FILE_CODE_ICON = new vscode.ThemeIcon("file-code");
const TREE_FILE_MEDIA_ICON = new vscode.ThemeIcon("file-media");
const TREE_FILE_PDF_ICON = new vscode.ThemeIcon("file-pdf");
const TREE_FILE_TEXT_ICON = new vscode.ThemeIcon("file-text");
const TREE_FILE_ZIP_ICON = new vscode.ThemeIcon("file-zip");

function getTreeFileExtension(fileName?: string, relativePath?: string): string {
  const name = fileName || relativePath || "";
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(lastDot).toLowerCase() : "";
}

export function resolveTreeFileIcon(fileName?: string, relativePath?: string): vscode.ThemeIcon {
  switch (getTreeFileExtension(fileName, relativePath)) {
    case ".jar":
    case ".war":
    case ".ear":
    case ".zip":
    case ".tar":
    case ".gz":
    case ".tgz":
      return TREE_FILE_ZIP_ICON;
    case ".log":
    case ".txt":
      return TREE_FILE_TEXT_ICON;
    case ".xml":
    case ".json":
    case ".yaml":
    case ".yml":
    case ".html":
    case ".htm":
    case ".js":
    case ".ts":
    case ".tsx":
    case ".jsx":
    case ".css":
    case ".scss":
      return TREE_FILE_CODE_ICON;
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".svg":
    case ".webp":
      return TREE_FILE_MEDIA_ICON;
    case ".pdf":
      return TREE_FILE_PDF_ICON;
    default:
      return TREE_FILE_ICON;
  }
}

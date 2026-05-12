import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope, buildTreeJobScopeKey } from "../TreeJobScope";

const FOLDER_ICON = new vscode.ThemeIcon("folder");
const FILE_ICON = new vscode.ThemeIcon("file");
const FILE_CODE_ICON = new vscode.ThemeIcon("file-code");
const FILE_MEDIA_ICON = new vscode.ThemeIcon("file-media");
const FILE_PDF_ICON = new vscode.ThemeIcon("file-pdf");
const FILE_TEXT_ICON = new vscode.ThemeIcon("file-text");
const FILE_ZIP_ICON = new vscode.ThemeIcon("file-zip");

function buildWorkspaceTreeItemId(
  kind: string,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope,
  relativePath?: string
): string {
  const baseId = `${kind}:${environment.scope}:${environment.environmentId}:${buildTreeJobScopeKey(jobScope)}:${jobUrl}`;
  return relativePath ? `${baseId}:${relativePath}` : baseId;
}

export class WorkspaceRootTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildWorkspaceTreeItemId("workspace-root", environment, jobUrl, jobScope);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly jobUrl: string,
    public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE
  ) {
    super("Workspace", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = WorkspaceRootTreeItem.buildId(environment, jobUrl, jobScope);
    this.contextValue = "workspaceRoot";
    this.iconPath = FOLDER_ICON;
    this.tooltip = "Browse the current Jenkins workspace.";
  }
}

export class WorkspaceDirectoryTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath: string
  ): string {
    return buildWorkspaceTreeItemId("workspace-dir", environment, jobUrl, jobScope, relativePath);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly jobUrl: string,
    public readonly relativePath: string,
    public readonly directoryName: string,
    public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE
  ) {
    super(directoryName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = WorkspaceDirectoryTreeItem.buildId(environment, jobUrl, jobScope, relativePath);
    this.contextValue = "workspaceDirectory";
    this.description = relativePath !== directoryName ? relativePath : undefined;
    this.iconPath = FOLDER_ICON;
    this.tooltip = relativePath;
  }
}

export class WorkspaceFileTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath: string
  ): string {
    return buildWorkspaceTreeItemId("workspace-file", environment, jobUrl, jobScope, relativePath);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly jobUrl: string,
    public readonly relativePath: string,
    public readonly fileName: string,
    public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE
  ) {
    super(fileName, vscode.TreeItemCollapsibleState.None);
    this.id = WorkspaceFileTreeItem.buildId(environment, jobUrl, jobScope, relativePath);
    this.contextValue = "workspaceFile";
    this.description = relativePath !== fileName ? relativePath : undefined;
    this.iconPath = resolveWorkspaceFileIcon(fileName, relativePath);
    this.tooltip = relativePath;
    this.command = {
      command: "jenkinsWorkbench.previewWorkspaceFile",
      title: "Preview Workspace File",
      arguments: [this]
    };
  }
}

function resolveWorkspaceFileIcon(fileName: string, relativePath: string): vscode.ThemeIcon {
  const name = fileName || relativePath;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  switch (extension) {
    case ".log":
    case ".txt":
      return FILE_TEXT_ICON;
    case ".json":
    case ".xml":
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
      return FILE_CODE_ICON;
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".svg":
    case ".webp":
      return FILE_MEDIA_ICON;
    case ".pdf":
      return FILE_PDF_ICON;
    case ".zip":
    case ".tar":
    case ".gz":
    case ".tgz":
    case ".jar":
    case ".war":
      return FILE_ZIP_ICON;
    default:
      return FILE_ICON;
  }
}

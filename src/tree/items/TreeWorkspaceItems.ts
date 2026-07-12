import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { TREE_FOLDER_ICON, resolveTreeFileIcon } from "../TreeFileIcons";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "../TreeJobScope";
import { buildEnvironmentTreeItemId } from "./TreeItemIds";

export class WorkspaceRootTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildEnvironmentTreeItemId("workspace-root", environment, jobScope, jobUrl);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly jobUrl: string,
    public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE
  ) {
    super("Workspace", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = WorkspaceRootTreeItem.buildId(environment, jobUrl, jobScope);
    this.contextValue = "workspaceRoot";
    this.iconPath = TREE_FOLDER_ICON;
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
    return buildEnvironmentTreeItemId("workspace-dir", environment, jobScope, jobUrl, relativePath);
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
    this.iconPath = TREE_FOLDER_ICON;
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
    return buildEnvironmentTreeItemId(
      "workspace-file",
      environment,
      jobScope,
      jobUrl,
      relativePath
    );
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
    this.iconPath = resolveTreeFileIcon(fileName, relativePath);
    this.tooltip = relativePath;
    this.command = {
      command: "jenkinsWorkbench.previewWorkspaceFile",
      title: "Preview Workspace File",
      arguments: [this]
    };
  }
}

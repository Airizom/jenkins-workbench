import * as vscode from "vscode";
import type { JenkinsBuild } from "../../jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { type BuildTooltipOptions, buildBuildTooltip } from "../BuildTooltips";
import { TREE_FOLDER_ICON, resolveTreeFileIcon } from "../TreeFileIcons";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope, buildTreeJobScopeKey } from "../TreeJobScope";
import { buildIcon, formatBuildDescription } from "../formatters";

export class BuildTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope
  ): string {
    return `build:${environment.scope}:${environment.environmentId}:${buildTreeJobScopeKey(jobScope)}:${buildUrl}`;
  }

  public readonly buildUrl: string;
  public readonly buildNumber: number;
  public readonly isBuilding: boolean;
  public readonly awaitingInput: boolean;
  public readonly jobNameHint?: string;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    build: JenkinsBuild,
    public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    tooltipOptions?: BuildTooltipOptions,
    jobNameHint?: string,
    awaitingInput = false
  ) {
    const label = `#${build.number}`;
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.buildUrl = build.url;
    this.buildNumber = build.number;
    this.isBuilding = Boolean(build.building);
    this.awaitingInput = awaitingInput;
    this.jobNameHint = jobNameHint;
    this.id = BuildTreeItem.buildId(environment, build.url, jobScope);
    this.contextValue = this.awaitingInput
      ? `${this.isBuilding ? "buildRunning" : "build"} awaitingInput`
      : this.isBuilding
        ? "buildRunning"
        : "build";
    this.description = formatBuildDescription(build, awaitingInput);
    this.iconPath = buildIcon(build, awaitingInput);
    this.tooltip = buildBuildTooltip(build, tooltipOptions);
    this.command = {
      command: "jenkinsWorkbench.showBuildDetails",
      title: "View Build Details",
      arguments: [this]
    };
  }
}

export class BuildArtifactsFolderTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope
  ): string {
    return `buildArtifacts:${environment.scope}:${environment.environmentId}:${buildTreeJobScopeKey(jobScope)}:${buildUrl}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly buildUrl: string,
    public readonly buildNumber: number,
    public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    public readonly jobNameHint?: string,
    artifactCount?: number
  ) {
    const hasArtifacts = typeof artifactCount === "number" ? artifactCount > 0 : true;
    super(
      "Artifacts",
      hasArtifacts
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = BuildArtifactsFolderTreeItem.buildId(environment, buildUrl, jobScope);
    this.contextValue = "artifactFolder";
    this.iconPath = TREE_FOLDER_ICON;
    if (typeof artifactCount === "number") {
      this.description =
        artifactCount > 0
          ? `${artifactCount} item${artifactCount === 1 ? "" : "s"}`
          : "No artifacts";
    }
  }
}

export class ArtifactTreeItem extends vscode.TreeItem {
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly buildUrl: string,
    public readonly buildNumber: number,
    public readonly relativePath: string,
    public readonly fileName?: string,
    public readonly jobNameHint?: string
  ) {
    const label = fileName || relativePath || "Artifact";
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "artifactItem";
    this.description =
      fileName && relativePath && relativePath !== fileName ? relativePath : undefined;
    this.iconPath = resolveTreeFileIcon(fileName, relativePath);
  }
}

import * as vscode from "vscode";
import type { JenkinsBuild } from "../../jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { type BuildTooltipOptions, buildBuildTooltip } from "../BuildTooltips";
import { buildIcon, formatBuildDescription } from "../formatters";
import { applyTreeFileIcon } from "../TreeFileIcons";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "../TreeJobScope";
import { buildEnvironmentTreeItemId } from "./TreeItemIds";

export class BuildTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildEnvironmentTreeItemId("build", environment, jobScope, buildUrl);
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
    const contextValue = this.isBuilding ? "buildRunning" : "build";
    this.contextValue = this.awaitingInput ? `${contextValue} awaitingInput` : contextValue;
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
    const displayPath = relativePath || label;
    applyTreeFileIcon(this, displayPath, "file");
    applyArtifactClickAction(this, displayPath);
  }
}

function applyArtifactClickAction(item: ArtifactTreeItem, displayPath: string): void {
  if (isBinaryArtifactName(displayPath)) {
    item.tooltip = `${displayPath}\nBinary artifact: use Download to save it.`;
    return;
  }
  item.tooltip = `${displayPath}\nClick to preview.`;
  item.command = {
    command: "jenkinsWorkbench.previewArtifact",
    title: "Preview Artifact",
    arguments: [item]
  };
}

// Clicking a row should not pull a multi-megabyte archive into a text editor; these stay
// reachable through the explicit Preview and Download actions.
const BINARY_ARTIFACT_EXTENSIONS = new Set([
  ".7z",
  ".bin",
  ".class",
  ".dll",
  ".ear",
  ".exe",
  ".gz",
  ".jar",
  ".so",
  ".tar",
  ".tgz",
  ".war",
  ".whl",
  ".zip"
]);

function isBinaryArtifactName(name: string): boolean {
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 && BINARY_ARTIFACT_EXTENSIONS.has(name.slice(lastDot).toLowerCase());
}

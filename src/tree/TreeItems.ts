import * as vscode from "vscode";
import { formatScopeLabel } from "../formatters/ScopeFormatters";
import type { JenkinsBuild, JenkinsJobKind } from "../jenkins/JenkinsClient";
import type { JenkinsNodeInfo } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentScope, JenkinsEnvironment } from "../storage/JenkinsEnvironmentStore";
import { buildBuildTooltip, type BuildTooltipOptions } from "./BuildTooltips";
import {
  buildIcon,
  formatBuildDescription,
  formatJobColor,
  formatNodeDescription,
  formatWatchedDescription,
  formatQueueItemDescription,
  isJobColorDisabled,
  jobIcon,
  normalizeQueueReason
} from "./formatters";

export type WorkbenchTreeElement =
  | RootSectionTreeItem
  | InstanceTreeItem
  | JobsFolderTreeItem
  | BuildQueueFolderTreeItem
  | NodesFolderTreeItem
  | JenkinsFolderTreeItem
  | JobTreeItem
  | PipelineTreeItem
  | BuildTreeItem
  | BuildArtifactsFolderTreeItem
  | ArtifactTreeItem
  | NodeTreeItem
  | QueueItemTreeItem
  | PlaceholderTreeItem;

export class RootSectionTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly section: "instances"
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = section;
  }
}

export class InstanceTreeItem extends vscode.TreeItem implements JenkinsEnvironmentRef {
  public readonly environmentId: string;
  public readonly scope: EnvironmentScope;
  public readonly url: string;
  public readonly username?: string;

  constructor(environment: JenkinsEnvironment & { scope: EnvironmentScope }) {
    super(environment.url, vscode.TreeItemCollapsibleState.Collapsed);
    this.environmentId = environment.id;
    this.scope = environment.scope;
    this.url = environment.url;
    this.username = environment.username;
    this.contextValue = "environment";
    this.description = formatScopeLabel(environment.scope);
    this.iconPath = new vscode.ThemeIcon("server-environment");
  }
}

export class JobsFolderTreeItem extends vscode.TreeItem {
  constructor(public readonly environment: JenkinsEnvironmentRef) {
    super("Jobs", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "jobs";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

export class NodesFolderTreeItem extends vscode.TreeItem {
  constructor(public readonly environment: JenkinsEnvironmentRef) {
    super("Nodes", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "nodes";
    this.iconPath = new vscode.ThemeIcon("server");
  }
}

export class BuildQueueFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `queue:${environment.scope}:${environment.environmentId}`;
  }

  constructor(public readonly environment: JenkinsEnvironmentRef) {
    super("Build Queue", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "queueFolder";
    this.iconPath = new vscode.ThemeIcon("list-unordered");
    this.id = BuildQueueFolderTreeItem.buildId(environment);
  }
}

export class JenkinsFolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly folderUrl: string,
    public readonly folderKind: JenkinsJobKind
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = folderKind === "multibranch" ? "multibranchFolder" : "folder";
    this.description = folderKind === "multibranch" ? "Multibranch" : undefined;
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

export class JobTreeItem extends vscode.TreeItem {
  public readonly isWatched: boolean;
  public readonly isPinned: boolean;
  public readonly isDisabled: boolean;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    color?: string,
    isWatched = false,
    isPinned = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.isWatched = isWatched;
    this.isPinned = isPinned;
    this.isDisabled = isJobColorDisabled(color);
    this.contextValue = buildJobContextValue("jobItem", isWatched, isPinned, this.isDisabled);
    this.description = formatWatchedDescription(formatJobColor(color), isWatched);
    this.iconPath = jobIcon("job", color);
  }
}

export class PipelineTreeItem extends vscode.TreeItem {
  public readonly isWatched: boolean;
  public readonly isPinned: boolean;
  public readonly isDisabled: boolean;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    color?: string,
    isWatched = false,
    isPinned = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.isWatched = isWatched;
    this.isPinned = isPinned;
    this.isDisabled = isJobColorDisabled(color);
    this.contextValue = buildJobContextValue("pipelineItem", isWatched, isPinned, this.isDisabled);
    this.description = formatWatchedDescription(formatJobColor(color), isWatched);
    this.iconPath = jobIcon("pipeline", color);
  }
}

function buildJobContextValue(
  base: "jobItem" | "pipelineItem",
  isWatched: boolean,
  isPinned: boolean,
  isDisabled: boolean
): string {
  const parts: string[] = [base];
  if (isPinned) {
    parts.push("pinned");
  }
  if (isWatched) {
    parts.push("watched");
  }
  if (isDisabled) {
    parts.push("disabled");
  } else {
    parts.push("enabled");
  }
  return parts.join(" ");
}

export class BuildTreeItem extends vscode.TreeItem {
  public readonly buildUrl: string;
  public readonly buildNumber: number;
  public readonly isBuilding: boolean;
  public readonly awaitingInput: boolean;
  public readonly jobNameHint?: string;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    build: JenkinsBuild,
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
    const contextParts = [this.isBuilding ? "buildRunning" : "build"];
    if (this.awaitingInput) {
      contextParts.push("awaitingInput");
    }
    this.contextValue = contextParts.join(" ");
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
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly buildUrl: string,
    public readonly buildNumber: number,
    public readonly jobNameHint?: string
  ) {
    super("Artifacts", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "artifactFolder";
    this.iconPath = new vscode.ThemeIcon("folder");
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
    this.iconPath = new vscode.ThemeIcon("file");
  }
}

export class NodeTreeItem extends vscode.TreeItem {
  public readonly nodeUrl?: string;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    node: JenkinsNodeInfo
  ) {
    super(node.displayName, vscode.TreeItemCollapsibleState.None);
    this.nodeUrl = node.nodeUrl;
    this.contextValue = node.nodeUrl ? "node nodeOpenable" : "node";
    this.description = formatNodeDescription(node);
    this.iconPath = node.offline
      ? new vscode.ThemeIcon("debug-disconnect")
      : new vscode.ThemeIcon("server");
    this.command = {
      command: "jenkinsWorkbench.showNodeDetails",
      title: "View Node Details",
      arguments: [this]
    };
  }
}

export class QueueItemTreeItem extends vscode.TreeItem {
  public readonly queueId: number;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    item: {
      id: number;
      name: string;
      position: number;
      reason?: string;
      inQueueSince?: number;
      taskUrl?: string;
    }
  ) {
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.queueId = item.id;
    this.contextValue = "queueItem";
    this.description = formatQueueItemDescription(item.position, item.inQueueSince, item.reason);
    this.tooltip = this.buildTooltip(item);
    this.iconPath = new vscode.ThemeIcon("clock");
  }

  private buildTooltip(item: {
    id: number;
    reason?: string;
    inQueueSince?: number;
    taskUrl?: string;
  }): string {
    const parts: string[] = [`Queue item ${item.id}`];
    if (item.taskUrl) {
      parts.push(item.taskUrl);
    }
    const normalizedReason = normalizeQueueReason(item.reason);
    if (normalizedReason) {
      parts.push(`Reason: ${normalizedReason}`);
    }
    if (typeof item.inQueueSince === "number") {
      parts.push(`Queued since: ${new Date(item.inQueueSince).toLocaleString()}`);
    }
    return parts.join("\n");
  }
}

export class PlaceholderTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description?: string,
    public readonly kind: "empty" | "error" = "empty"
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "placeholder";
    this.description = description;
    this.tooltip = description;
    this.iconPath =
      kind === "error" ? new vscode.ThemeIcon("warning") : new vscode.ThemeIcon("info");
  }
}

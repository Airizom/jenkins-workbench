import * as vscode from "vscode";
import { formatScopeLabel } from "../formatters/ScopeFormatters";
import type { JenkinsBuild, JenkinsJobKind, JenkinsNode } from "../jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentScope, JenkinsEnvironment } from "../storage/JenkinsEnvironmentStore";
import {
  buildIcon,
  formatBuildStatus,
  formatJobColor,
  formatWatchedDescription,
  formatQueueItemDescription,
  jobIcon,
  normalizeQueueReason
} from "./formatters";

export type WorkbenchTreeElement =
  | RootSectionTreeItem
  | SettingsEnvironmentsTreeItem
  | EnvironmentGroupTreeItem
  | SettingsEnvironmentTreeItem
  | InstanceTreeItem
  | JobsFolderTreeItem
  | BuildQueueFolderTreeItem
  | NodesFolderTreeItem
  | JenkinsFolderTreeItem
  | JobTreeItem
  | PipelineTreeItem
  | BuildTreeItem
  | NodeTreeItem
  | QueueItemTreeItem
  | PlaceholderTreeItem;

export class RootSectionTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly section: "instances" | "settings"
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = section;
  }
}

export class SettingsEnvironmentsTreeItem extends vscode.TreeItem {
  constructor() {
    super("Environments", vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "settingsEnvironments";
  }
}

export class EnvironmentGroupTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly scope: EnvironmentScope
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "environmentGroup";
  }
}

export class SettingsEnvironmentTreeItem extends vscode.TreeItem implements JenkinsEnvironmentRef {
  public readonly environmentId: string;
  public readonly scope: EnvironmentScope;
  public readonly url: string;
  public readonly username?: string;

  constructor(environmentId: string, scope: EnvironmentScope, url: string, username?: string) {
    super(url, vscode.TreeItemCollapsibleState.None);
    this.environmentId = environmentId;
    this.scope = scope;
    this.url = url;
    this.username = username;
    this.contextValue = "environment";
    this.description = formatScopeLabel(scope);
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

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    color?: string,
    isWatched = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.isWatched = isWatched;
    this.contextValue = isWatched ? "jobWatched" : "jobUnwatched";
    this.description = formatWatchedDescription(formatJobColor(color), isWatched);
    this.iconPath = jobIcon("job", color);
  }
}

export class PipelineTreeItem extends vscode.TreeItem {
  public readonly isWatched: boolean;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    color?: string,
    isWatched = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.isWatched = isWatched;
    this.contextValue = isWatched ? "pipelineWatched" : "pipelineUnwatched";
    this.description = formatWatchedDescription(formatJobColor(color), isWatched);
    this.iconPath = jobIcon("pipeline", color);
  }
}

export class BuildTreeItem extends vscode.TreeItem {
  public readonly buildUrl: string;
  public readonly isBuilding: boolean;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    build: JenkinsBuild
  ) {
    const label = `#${build.number}`;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.buildUrl = build.url;
    this.isBuilding = Boolean(build.building);
    this.contextValue = this.isBuilding ? "buildRunning" : "build";
    this.description = formatBuildStatus(build);
    this.iconPath = buildIcon(build);
    this.tooltip = build.url;
    this.command = {
      command: "jenkinsWorkbench.showBuildDetails",
      title: "View Build Details",
      arguments: [this]
    };
  }
}

export class NodeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    node: JenkinsNode
  ) {
    super(node.displayName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "node";
    this.description = node.offline
      ? node.temporarilyOffline
        ? "Temporarily offline"
        : "Offline"
      : "Online";
    this.iconPath = node.offline
      ? new vscode.ThemeIcon("debug-disconnect")
      : new vscode.ThemeIcon("server");
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

import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import { formatEnvironmentLabel } from "../../jenkins/EnvironmentLabels";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentScope, JenkinsEnvironment } from "../../storage/JenkinsEnvironmentStore";
import type { ActivityDisplaySummary, ActivityGroupKind } from "../ActivityTypes";
import { formatActivityGroupLabel } from "../ActivityTypes";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "../TreeJobScope";
import type {
  JobsFolderSummary,
  NodesFolderSummary,
  QueueFolderSummary
} from "./TreeItemSummaries";

const ACTIVITY_GROUP_AWAITING_INPUT_ICON = new vscode.ThemeIcon(
  "debug-pause",
  new vscode.ThemeColor("charts.blue")
);
const ACTIVITY_GROUP_FAILING_ICON = new vscode.ThemeIcon(
  "error",
  new vscode.ThemeColor("charts.red")
);
const ACTIVITY_GROUP_RUNNING_ICON = new vscode.ThemeIcon(
  "sync~spin",
  new vscode.ThemeColor("charts.blue")
);
const ACTIVITY_GROUP_UNSTABLE_ICON = new vscode.ThemeIcon(
  "warning",
  new vscode.ThemeColor("charts.yellow")
);
const FOLDER_ICON = new vscode.ThemeIcon("folder");
const LIST_UNORDERED_ICON = new vscode.ThemeIcon("list-unordered");
const PINNED_ICON = new vscode.ThemeIcon("pinned");
const PULSE_ICON = new vscode.ThemeIcon("pulse");
const SERVER_ENVIRONMENT_ICON = new vscode.ThemeIcon("server-environment");
const SERVER_ICON = new vscode.ThemeIcon("server");

export class ViewsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `views:${environment.scope}:${environment.environmentId}`;
  }

  constructor(public readonly environment: JenkinsEnvironmentRef) {
    super("Views", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = ViewsFolderTreeItem.buildId(environment);
    this.contextValue = "views";
    this.iconPath = FOLDER_ICON;
    this.tooltip = "Browse curated Jenkins views";
  }
}

export class RootSectionTreeItem extends vscode.TreeItem {
  static buildId(section: "instances"): string {
    return `root:${section}`;
  }

  constructor(
    label: string,
    public readonly section: "instances"
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = RootSectionTreeItem.buildId(section);
    this.contextValue = section;
  }
}

export class InstanceTreeItem extends vscode.TreeItem implements JenkinsEnvironmentRef {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `environment:${environment.scope}:${environment.environmentId}`;
  }

  public readonly environmentId: string;
  public readonly scope: EnvironmentScope;
  public readonly url: string;
  public readonly username?: string;

  constructor(environment: JenkinsEnvironment & { scope: EnvironmentScope }) {
    const label = formatEnvironmentLabel(environment.url);
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.environmentId = environment.id;
    this.scope = environment.scope;
    this.url = environment.url;
    this.username = environment.username;
    this.id = InstanceTreeItem.buildId({
      environmentId: environment.id,
      scope: environment.scope,
      url: environment.url,
      username: environment.username
    });
    this.contextValue = "environment";
    this.description = formatScopeLabel(environment.scope);
    this.iconPath = SERVER_ENVIRONMENT_ICON;
    this.tooltip = buildEnvironmentTooltip(environment);
  }
}

export class JobsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `jobs:${environment.scope}:${environment.environmentId}`;
  }

  public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: JobsFolderSummary
  ) {
    const label = summary ? `Jobs (${summary.total})` : "Jobs";
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = JobsFolderTreeItem.buildId(environment);
    this.contextValue = "jobs";
    this.iconPath = FOLDER_ICON;
    this.description = summary ? formatJobsSummaryDescription(summary) : undefined;
    this.tooltip = summary
      ? formatJobsSummaryTooltip(summary)
      : "Browse jobs, pipelines, and folders";
  }
}

export class ActivityFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `activity:${environment.scope}:${environment.environmentId}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: ActivityDisplaySummary
  ) {
    const label = summary
      ? `Activity (${formatDisplayedCountLabel(summary.displayedTotal)})`
      : "Activity";
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = ActivityFolderTreeItem.buildId(environment);
    this.contextValue = "activity";
    this.iconPath = PULSE_ICON;
    this.description = summary ? formatActivitySummaryDescription(summary) : undefined;
    this.tooltip = summary
      ? formatActivitySummaryTooltip(summary)
      : "Current Jenkins activity and jobs needing attention";
  }
}

export class ActivityGroupTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef, group: ActivityGroupKind): string {
    return `activity-group:${environment.scope}:${environment.environmentId}:${group}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly group: ActivityGroupKind,
    displayedCount: number,
    isTruncated = false
  ) {
    super(
      `${formatActivityGroupLabel(group)} (${formatDisplayedCountLabel(displayedCount)})`,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = ActivityGroupTreeItem.buildId(environment, group);
    this.contextValue = "activityGroup";
    this.iconPath = resolveActivityGroupIcon(group);
    this.tooltip = `${formatDisplayedCountTooltip(displayedCount, isTruncated)} ${formatActivityGroupLabel(group).toLowerCase()} job(s)`;
  }
}

export class NodesFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `nodes:${environment.scope}:${environment.environmentId}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: NodesFolderSummary
  ) {
    const label = summary
      ? `Nodes (${summary.online} online, ${summary.offline} offline)`
      : "Nodes";
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = NodesFolderTreeItem.buildId(environment);
    this.contextValue = "nodes";
    this.iconPath = SERVER_ICON;
    this.tooltip = summary
      ? `Online: ${summary.online}\nOffline: ${summary.offline}`
      : "View build agents and their status";
  }
}

export class BuildQueueFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `queue:${environment.scope}:${environment.environmentId}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: QueueFolderSummary
  ) {
    const label = summary ? `Build Queue (${summary.total})` : "Build Queue";
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "queueFolder";
    this.iconPath = LIST_UNORDERED_ICON;
    this.id = BuildQueueFolderTreeItem.buildId(environment);
    this.tooltip = summary ? `${summary.total} item(s) waiting` : "Items waiting to be built";
  }
}

export class PinnedJobsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `pinned-root:${environment.scope}:${environment.environmentId}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    count?: number
  ) {
    super("Pinned", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = PinnedJobsFolderTreeItem.buildId(environment);
    this.contextValue = "pinnedRoot";
    this.iconPath = PINNED_ICON;
    this.description = typeof count === "number" ? `${count} item(s)` : undefined;
    this.tooltip =
      typeof count === "number"
        ? `${count} pinned job(s) or pipeline(s)`
        : "Quick access to pinned jobs and pipelines";
  }
}

export class PinnedSectionTreeItem extends vscode.TreeItem {
  constructor() {
    super("Pinned", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "pinnedSection";
    this.iconPath = PINNED_ICON;
  }
}

function buildEnvironmentTooltip(
  environment: JenkinsEnvironment & { scope: EnvironmentScope }
): string {
  const scopeLabel = formatScopeLabel(environment.scope);
  const parts = [`${environment.url}`, `Scope: ${scopeLabel}`];
  if (environment.username) {
    parts.push(`User: ${environment.username}`);
  }
  return parts.join("\n");
}

function formatJobsSummaryDescription(summary: JobsFolderSummary): string | undefined {
  const parts: string[] = [];
  if (summary.folders > 0) {
    parts.push(`${summary.folders} folders`);
  }
  if (summary.pipelines > 0) {
    parts.push(`${summary.pipelines} pipelines`);
  }
  if (summary.jobs > 0) {
    parts.push(`${summary.jobs} jobs`);
  }
  if (summary.running > 0) {
    parts.push(`${summary.running} running`);
  }
  if (summary.disabled > 0) {
    parts.push(`${summary.disabled} disabled`);
  }
  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function formatJobsSummaryTooltip(summary: JobsFolderSummary): string {
  const parts = [
    `Total: ${summary.total}`,
    `Jobs: ${summary.jobs}`,
    `Pipelines: ${summary.pipelines}`,
    `Folders: ${summary.folders}`
  ];
  if (summary.running > 0) {
    parts.push(`Running: ${summary.running}`);
  }
  if (summary.disabled > 0) {
    parts.push(`Disabled: ${summary.disabled}`);
  }
  return parts.join("\n");
}

function formatActivitySummaryDescription(summary: ActivityDisplaySummary): string | undefined {
  const parts: string[] = [];
  for (const group of summary.groups) {
    if (group.displayedCount > 0) {
      parts.push(
        `${formatDisplayedCountLabel(group.displayedCount)} ${formatActivityGroupLabel(group.kind).toLowerCase()}`
      );
    }
  }
  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function formatActivitySummaryTooltip(summary: ActivityDisplaySummary): string {
  if (summary.displayedTotal === 0) {
    return "No current activity.";
  }
  const parts: string[] = [];
  for (const group of summary.groups) {
    if (group.displayedCount > 0) {
      parts.push(
        `${formatActivityGroupLabel(group.kind)}: ${formatDisplayedCountTooltip(group.displayedCount, group.isTruncated)}`
      );
    }
  }
  return parts.join("\n");
}

function formatDisplayedCountLabel(count: number): string {
  return `${count} shown`;
}

function formatDisplayedCountTooltip(count: number, isTruncated: boolean): string {
  return isTruncated ? `${count} shown, more may exist` : `${count} shown`;
}

function resolveActivityGroupIcon(group: ActivityGroupKind): vscode.ThemeIcon {
  switch (group) {
    case "awaitingInput":
      return ACTIVITY_GROUP_AWAITING_INPUT_ICON;
    case "failing":
      return ACTIVITY_GROUP_FAILING_ICON;
    case "unstable":
      return ACTIVITY_GROUP_UNSTABLE_ICON;
    case "running":
      return ACTIVITY_GROUP_RUNNING_ICON;
  }
}

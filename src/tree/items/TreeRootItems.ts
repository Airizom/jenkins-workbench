import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import { formatEnvironmentLabel } from "../../jenkins/EnvironmentLabels";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentScope, JenkinsEnvironment } from "../../storage/JenkinsEnvironmentStore";
import type { ActivityDisplaySummary, ActivityGroupKind } from "../ActivityTypes";
import { formatActivityGroupLabel } from "../ActivityTypes";
import { AWAITING_INPUT_THEME_COLOR } from "../formatters";
import { formatBoundedCount, formatCountLabel } from "../TreeCountLabels";
import { formatEnvironmentIssueLabel, type TreeEnvironmentIssueKind } from "../TreeLoadErrors";
import { buildEnvironmentTreeItemId } from "./TreeItemIds";
import type {
  JobsFolderSummary,
  NodesFolderSummary,
  QueueFolderSummary
} from "./TreeItemSummaries";

const ACTIVITY_GROUP_AWAITING_INPUT_ICON = new vscode.ThemeIcon(
  "debug-pause",
  AWAITING_INPUT_THEME_COLOR
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
const SERVER_ENVIRONMENT_ISSUE_ICON = new vscode.ThemeIcon(
  "warning",
  new vscode.ThemeColor("list.warningForeground")
);
const SERVER_ICON = new vscode.ThemeIcon("server");

export class ViewsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return buildEnvironmentTreeItemId("views", environment);
  }

  constructor(public readonly environment: JenkinsEnvironmentRef) {
    super("Views", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = ViewsFolderTreeItem.buildId(environment);
    this.contextValue = "views";
    this.iconPath = FOLDER_ICON;
    this.tooltip = "Browse curated Jenkins views";
  }
}

export interface InstanceTreeItemIssue {
  kind: TreeEnvironmentIssueKind;
  message: string;
}

export class InstanceTreeItem extends vscode.TreeItem implements JenkinsEnvironmentRef {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return buildEnvironmentTreeItemId("environment", environment);
  }

  public readonly environmentId: string;
  public readonly scope: EnvironmentScope;
  public readonly url: string;
  public readonly username?: string;

  constructor(
    environment: JenkinsEnvironment & { scope: EnvironmentScope },
    issue?: InstanceTreeItemIssue
  ) {
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
    const identity = [formatScopeLabel(environment.scope), environment.username].filter(Boolean);
    this.description = (
      issue ? [formatEnvironmentIssueLabel(issue.kind), ...identity] : identity
    ).join(" • ");
    this.iconPath = issue ? SERVER_ENVIRONMENT_ISSUE_ICON : SERVER_ENVIRONMENT_ICON;
    this.tooltip = buildEnvironmentTooltip(environment, issue);
  }
}

export class JobsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return buildEnvironmentTreeItemId("jobs", environment);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: JobsFolderSummary
  ) {
    super("Jobs", vscode.TreeItemCollapsibleState.Collapsed);
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
    return buildEnvironmentTreeItemId("activity", environment);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: ActivityDisplaySummary
  ) {
    super("Activity", vscode.TreeItemCollapsibleState.Collapsed);
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
    return buildEnvironmentTreeItemId("activity-group", environment, group);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly group: ActivityGroupKind,
    displayedCount: number,
    isTruncated = false
  ) {
    const groupLabel = formatActivityGroupLabel(group);
    super(groupLabel, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = ActivityGroupTreeItem.buildId(environment, group);
    this.contextValue = "activityGroup";
    this.iconPath = resolveActivityGroupIcon(group);
    this.description = formatBoundedCount(displayedCount, isTruncated);
    this.tooltip = formatActivityGroupTooltip(groupLabel, displayedCount, isTruncated);
  }
}

export class NodesFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return buildEnvironmentTreeItemId("nodes", environment);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: NodesFolderSummary
  ) {
    super("Nodes", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = NodesFolderTreeItem.buildId(environment);
    this.contextValue = "nodes";
    this.iconPath = SERVER_ICON;
    this.description = summary ? formatNodesSummaryDescription(summary) : undefined;
    this.tooltip = summary
      ? `Online: ${summary.online}\nOffline: ${summary.offline}`
      : "View build agents and their status";
  }
}

export class BuildQueueFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return buildEnvironmentTreeItemId("queue", environment);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    summary?: QueueFolderSummary
  ) {
    super("Build Queue", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "queueFolder";
    this.iconPath = LIST_UNORDERED_ICON;
    this.id = BuildQueueFolderTreeItem.buildId(environment);
    this.description = summary
      ? summary.total > 0
        ? `${summary.total} waiting`
        : "Empty"
      : undefined;
    this.tooltip = summary
      ? `${formatCountLabel(summary.total, "item")} waiting to be built`
      : "Items waiting to be built";
  }
}

export class PinnedJobsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return buildEnvironmentTreeItemId("pinned-root", environment);
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    count?: number
  ) {
    super("Pinned", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = PinnedJobsFolderTreeItem.buildId(environment);
    this.contextValue = "pinnedRoot";
    this.iconPath = PINNED_ICON;
    this.description = typeof count === "number" ? formatCountLabel(count, "job") : undefined;
    this.tooltip = "Quick access to pinned jobs and pipelines";
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
  environment: JenkinsEnvironment & { scope: EnvironmentScope },
  issue?: InstanceTreeItemIssue
): string {
  const scopeLabel = formatScopeLabel(environment.scope);
  const parts = [`${environment.url}`, `Scope: ${scopeLabel}`];
  if (environment.username) {
    parts.push(`User: ${environment.username}`);
  }
  if (issue) {
    parts.push("", `${formatEnvironmentIssueLabel(issue.kind)}: ${issue.message}`);
  }
  return parts.join("\n");
}

function formatJobsSummaryDescription(summary: JobsFolderSummary): string {
  const parts = [formatCountLabel(summary.total, "item")];
  if (summary.running > 0) {
    parts.push(`${summary.running} running`);
  }
  if (summary.disabled > 0) {
    parts.push(`${summary.disabled} disabled`);
  }
  return parts.join(" • ");
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

function formatNodesSummaryDescription(summary: NodesFolderSummary): string {
  const parts = [`${summary.online} online`];
  if (summary.offline > 0) {
    parts.push(`${summary.offline} offline`);
  }
  return parts.join(" • ");
}

function formatActivitySummaryDescription(summary: ActivityDisplaySummary): string | undefined {
  const parts: string[] = [];
  for (const group of summary.groups) {
    if (group.displayedCount > 0) {
      parts.push(
        `${formatBoundedCount(group.displayedCount, group.isTruncated)} ${formatActivityGroupLabel(group.kind).toLowerCase()}`
      );
    }
  }
  return parts.length > 0 ? parts.join(" • ") : "No activity";
}

function formatActivitySummaryTooltip(summary: ActivityDisplaySummary): string {
  if (summary.displayedTotal === 0) {
    return "No jobs are failing, unstable, running, or awaiting input.";
  }
  const parts: string[] = [];
  for (const group of summary.groups) {
    if (group.displayedCount > 0) {
      parts.push(
        `${formatActivityGroupLabel(group.kind)}: ${formatBoundedCount(group.displayedCount, group.isTruncated)}`
      );
    }
  }
  if (summary.isTruncated) {
    parts.push("", "Lists are capped; + means more may exist.");
  }
  return parts.join("\n");
}

function formatActivityGroupTooltip(
  groupLabel: string,
  displayedCount: number,
  isTruncated: boolean
): string {
  const jobs = formatCountLabel(displayedCount, "job");
  return isTruncated
    ? `Showing the first ${jobs} (${groupLabel.toLowerCase()}); more may exist.`
    : `${jobs} (${groupLabel.toLowerCase()})`;
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

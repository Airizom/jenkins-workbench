import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentScope, JenkinsEnvironment } from "../../storage/JenkinsEnvironmentStore";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "../TreeJobScope";
import type {
  JobsFolderSummary,
  NodesFolderSummary,
  QueueFolderSummary
} from "./TreeItemSummaries";

export class ViewsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef): string {
    return `views:${environment.scope}:${environment.environmentId}`;
  }

  constructor(public readonly environment: JenkinsEnvironmentRef) {
    super("Views", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = ViewsFolderTreeItem.buildId(environment);
    this.contextValue = "views";
    this.iconPath = new vscode.ThemeIcon("folder");
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
    this.iconPath = new vscode.ThemeIcon("server-environment");
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
    this.iconPath = new vscode.ThemeIcon("folder");
    this.description = summary ? formatJobsSummaryDescription(summary) : undefined;
    this.tooltip = summary
      ? formatJobsSummaryTooltip(summary)
      : "Browse jobs, pipelines, and folders";
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
    this.iconPath = new vscode.ThemeIcon("server");
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
    this.iconPath = new vscode.ThemeIcon("list-unordered");
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
    this.iconPath = new vscode.ThemeIcon("pinned");
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
    this.iconPath = new vscode.ThemeIcon("pinned");
  }
}

function formatEnvironmentLabel(rawUrl: string): string {
  const parsed = tryParseUrl(rawUrl) ?? tryParseUrl(`https://${rawUrl}`);
  if (!parsed) {
    return rawUrl;
  }
  const host = parsed.host || parsed.hostname;
  const path = parsed.pathname.replace(/\/+$/, "");
  return path && path !== "/" ? `${host}${path}` : host || rawUrl;
}

function tryParseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
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

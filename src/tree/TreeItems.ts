import * as vscode from "vscode";
import { formatScopeLabel } from "../formatters/ScopeFormatters";
import type { JenkinsBuild, JenkinsJobKind } from "../jenkins/JenkinsClient";
import type { JenkinsNodeInfo } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentScope, JenkinsEnvironment } from "../storage/JenkinsEnvironmentStore";
import {
  formatMultibranchFolderDescription,
  formatMultibranchFolderTooltip
} from "./branchFilters";
import { type BuildTooltipOptions, buildBuildTooltip } from "./BuildTooltips";
import {
  buildIcon,
  formatBuildDescription,
  formatJobColor,
  formatJobDescription,
  formatNodeDescription,
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
  | PinnedSectionTreeItem
  | JenkinsFolderTreeItem
  | JobTreeItem
  | PipelineTreeItem
  | BuildTreeItem
  | BuildArtifactsFolderTreeItem
  | ArtifactTreeItem
  | NodeTreeItem
  | QueueItemTreeItem
  | PlaceholderTreeItem;

export interface JobsFolderSummary {
  total: number;
  jobs: number;
  pipelines: number;
  folders: number;
  disabled: number;
}

export interface NodesFolderSummary {
  total: number;
  online: number;
  offline: number;
}

export interface QueueFolderSummary {
  total: number;
}

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

export class PinnedSectionTreeItem extends vscode.TreeItem {
  constructor() {
    super("Pinned", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "pinnedSection";
    this.iconPath = new vscode.ThemeIcon("pinned");
  }
}

export class JenkinsFolderTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef, folderUrl: string): string {
    return `folder:${environment.scope}:${environment.environmentId}:${folderUrl}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly folderUrl: string,
    public readonly folderKind: JenkinsJobKind,
    options?: {
      branchFilter?: string;
    }
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = JenkinsFolderTreeItem.buildId(environment, folderUrl);
    this.contextValue = folderKind === "multibranch" ? "multibranchFolder" : "folder";
    this.description =
      folderKind === "multibranch"
        ? formatMultibranchFolderDescription(options?.branchFilter)
        : undefined;
    this.tooltip =
      folderKind === "multibranch"
        ? formatMultibranchFolderTooltip(options?.branchFilter)
        : undefined;
    this.iconPath =
      folderKind === "multibranch"
        ? new vscode.ThemeIcon("git-branch")
        : new vscode.ThemeIcon("folder");
  }
}

export class JobTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef, jobUrl: string): string {
    return `job:${environment.scope}:${environment.environmentId}:${jobUrl}`;
  }

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
    this.id = JobTreeItem.buildId(environment, jobUrl);
    this.contextValue = buildJobContextValue("jobItem", isWatched, isPinned, this.isDisabled);
    this.description = formatJobDescription({
      status: formatJobColor(color),
      isWatched,
      isPinned,
      isDisabled: this.isDisabled
    });
    this.iconPath = jobIcon("job", color);
  }
}

export class PipelineTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef, jobUrl: string): string {
    return `pipeline:${environment.scope}:${environment.environmentId}:${jobUrl}`;
  }

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
    this.id = PipelineTreeItem.buildId(environment, jobUrl);
    this.contextValue = buildJobContextValue("pipelineItem", isWatched, isPinned, this.isDisabled);
    this.description = formatJobDescription({
      status: formatJobColor(color),
      isWatched,
      isPinned,
      isDisabled: this.isDisabled
    });
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
  static buildId(environment: JenkinsEnvironmentRef, buildUrl: string): string {
    return `build:${environment.scope}:${environment.environmentId}:${buildUrl}`;
  }

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
    this.id = BuildTreeItem.buildId(environment, build.url);
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
  static buildId(environment: JenkinsEnvironmentRef, buildUrl: string): string {
    return `buildArtifacts:${environment.scope}:${environment.environmentId}:${buildUrl}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly buildUrl: string,
    public readonly buildNumber: number,
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
    this.id = BuildArtifactsFolderTreeItem.buildId(environment, buildUrl);
    this.contextValue = "artifactFolder";
    this.iconPath = new vscode.ThemeIcon("folder");
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
    this.iconPath = resolveArtifactIcon(fileName, relativePath);
  }
}

function resolveArtifactIcon(fileName?: string, relativePath?: string): vscode.ThemeIcon {
  const ext = getFileExtension(fileName, relativePath);
  switch (ext) {
    case ".jar":
    case ".war":
    case ".ear":
    case ".zip":
    case ".tar":
    case ".gz":
    case ".tgz":
      return new vscode.ThemeIcon("file-zip");
    case ".log":
    case ".txt":
      return new vscode.ThemeIcon("file-text");
    case ".xml":
    case ".json":
    case ".yaml":
    case ".yml":
    case ".html":
    case ".htm":
      return new vscode.ThemeIcon("file-code");
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".svg":
    case ".webp":
      return new vscode.ThemeIcon("file-media");
    case ".pdf":
      return new vscode.ThemeIcon("file-pdf");
    default:
      return new vscode.ThemeIcon("file");
  }
}

function getFileExtension(fileName?: string, relativePath?: string): string {
  const name = fileName || relativePath || "";
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(lastDot).toLowerCase() : "";
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
      ? new vscode.ThemeIcon("plug", new vscode.ThemeColor("charts.gray"))
      : new vscode.ThemeIcon("server");
    const tooltip = buildNodeTooltip(node);
    if (tooltip) {
      this.tooltip = tooltip;
    }
    this.command = {
      command: "jenkinsWorkbench.showNodeDetails",
      title: "View Node Details",
      arguments: [this]
    };
  }
}

function buildNodeTooltip(node: JenkinsNodeInfo): string | undefined {
  if (!node.offline) {
    return undefined;
  }
  const reason = formatNodeOfflineReason(node);
  const statusLabel = node.temporarilyOffline ? "Temporarily offline" : "Offline";
  return reason ? `${statusLabel}\n${reason}` : statusLabel;
}

function formatNodeOfflineReason(node: JenkinsNodeInfo): string | undefined {
  const reason =
    node.offlineCauseReason?.trim() ||
    node.offlineCause?.description?.trim() ||
    node.offlineCause?.shortDescription?.trim();
  return reason && reason.length > 0 ? reason : undefined;
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
    this.description = formatQueueItemDescription(item.position, item.inQueueSince);
    this.tooltip = this.buildTooltip(item);
    this.iconPath = new vscode.ThemeIcon("clock");
  }

  private buildTooltip(item: {
    id: number;
    reason?: string;
    inQueueSince?: number;
    taskUrl?: string;
  }): string {
    const parts: string[] = [];
    const normalizedReason = normalizeQueueReason(item.reason);
    if (normalizedReason) {
      parts.push(normalizedReason);
    } else {
      parts.push("Waiting in queue");
    }
    if (item.taskUrl) {
      parts.push(item.taskUrl);
    }
    parts.push(`Queue ID: ${item.id}`);
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
    public readonly kind: "empty" | "error" | "loading" = "empty"
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "placeholder";
    this.description = description;
    this.tooltip = description ? `${label}\n${description}` : label;
    this.iconPath =
      kind === "error"
        ? new vscode.ThemeIcon("warning")
        : kind === "loading"
          ? new vscode.ThemeIcon("sync~spin")
          : new vscode.ThemeIcon("info");
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
  if (summary.disabled > 0) {
    parts.push(`Disabled: ${summary.disabled}`);
  }
  return parts.join("\n");
}

import * as vscode from "vscode";
import type { JenkinsJobKind } from "../../jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { ActivityGroupKind } from "../ActivityTypes";
import {
  ROOT_TREE_JOB_SCOPE,
  type TreeJobScope,
  buildTreeJobScopeKey,
  createViewTreeJobScope
} from "../TreeJobScope";
import {
  formatMultibranchFolderDescription,
  formatMultibranchFolderTooltip
} from "../branchFilters";
import {
  formatJobColor,
  formatJobDescription,
  formatPinnedJobPathContext,
  formatPinnedJobTooltip,
  isJobColorDisabled,
  jobIcon
} from "../formatters";

const EYE_ICON = new vscode.ThemeIcon("eye");
const FOLDER_ICON = new vscode.ThemeIcon("folder");
const GIT_BRANCH_ICON = new vscode.ThemeIcon("git-branch");
const WARNING_ICON = new vscode.ThemeIcon("warning");

export class JenkinsViewTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef, viewUrl: string): string {
    return `view:${environment.scope}:${environment.environmentId}:${viewUrl}`;
  }

  public readonly jobScope: TreeJobScope;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly viewUrl: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.jobScope = createViewTreeJobScope(viewUrl);
    this.id = JenkinsViewTreeItem.buildId(environment, viewUrl);
    this.contextValue = "view";
    this.iconPath = EYE_ICON;
    this.tooltip = `Browse jobs in view "${label}"`;
  }
}

export class JenkinsFolderTreeItem extends vscode.TreeItem {
  static buildId(
    environment: JenkinsEnvironmentRef,
    folderUrl: string,
    scope: TreeJobScope
  ): string {
    return `folder:${environment.scope}:${environment.environmentId}:${buildTreeJobScopeKey(scope)}:${folderUrl}`;
  }

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly folderUrl: string,
    public readonly folderKind: JenkinsJobKind,
    public readonly jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    options?: {
      branchFilter?: string;
    }
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = JenkinsFolderTreeItem.buildId(environment, folderUrl, jobScope);
    this.contextValue = folderKind === "multibranch" ? "multibranchFolder" : "folder";
    this.description =
      folderKind === "multibranch"
        ? formatMultibranchFolderDescription(options?.branchFilter)
        : undefined;
    this.tooltip =
      folderKind === "multibranch"
        ? formatMultibranchFolderTooltip(options?.branchFilter)
        : undefined;
    this.iconPath = folderKind === "multibranch" ? GIT_BRANCH_ICON : FOLDER_ICON;
  }
}

type JobTreePresentation = "job" | "pipeline";

function buildJobLikeTreeItemId(
  presentation: JobTreePresentation,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope
): string {
  return `${presentation}:${environment.scope}:${environment.environmentId}:${buildTreeJobScopeKey(jobScope)}:${jobUrl}`;
}

abstract class JobLikeTreeItem extends vscode.TreeItem {
  public readonly isWatched: boolean;
  public readonly isPinned: boolean;
  public readonly isDisabled: boolean;

  protected constructor(
    presentation: JobTreePresentation,
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    public readonly jobScope: TreeJobScope,
    color: string | undefined,
    isWatched: boolean,
    isPinned: boolean
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    const contextBase = presentation === "pipeline" ? "pipelineItem" : "jobItem";
    this.isWatched = isWatched;
    this.isPinned = isPinned;
    this.isDisabled = isJobColorDisabled(color);
    this.id = buildJobLikeTreeItemId(presentation, environment, jobUrl, jobScope);
    this.contextValue = buildJobContextValue(contextBase, isWatched, isPinned, this.isDisabled);
    this.description = formatJobDescription({
      status: formatJobColor(color),
      isWatched,
      isPinned,
      isDisabled: this.isDisabled
    });
    this.iconPath = jobIcon(presentation, color);
  }
}

export class JobTreeItem extends JobLikeTreeItem {
  constructor(
    environment: JenkinsEnvironmentRef,
    label: string,
    jobUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    color?: string,
    isWatched = false,
    isPinned = false
  ) {
    super("job", environment, label, jobUrl, jobScope, color, isWatched, isPinned);
  }
}

export class PipelineTreeItem extends JobLikeTreeItem {
  constructor(
    environment: JenkinsEnvironmentRef,
    label: string,
    jobUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    color?: string,
    isWatched = false,
    isPinned = false
  ) {
    super("pipeline", environment, label, jobUrl, jobScope, color, isWatched, isPinned);
  }
}

export class QuickAccessJobTreeItem extends JobTreeItem {
  constructor(
    environment: JenkinsEnvironmentRef,
    label: string,
    jobUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    color?: string,
    isWatched = false,
    isPinned = true
  ) {
    super(environment, label, jobUrl, jobScope, color, isWatched, isPinned);
    applyQuickAccessPresentation(this, label, jobUrl, color, isWatched);
  }
}

export class QuickAccessPipelineTreeItem extends PipelineTreeItem {
  constructor(
    environment: JenkinsEnvironmentRef,
    label: string,
    jobUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    color?: string,
    isWatched = false,
    isPinned = true
  ) {
    super(environment, label, jobUrl, jobScope, color, isWatched, isPinned);
    applyQuickAccessPresentation(this, label, jobUrl, color, isWatched);
  }
}

export class ActivityJobTreeItem extends JobTreeItem {
  constructor(
    environment: JenkinsEnvironmentRef,
    label: string,
    jobUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    color?: string,
    isWatched = false,
    isPinned = false,
    group: ActivityGroupKind = "running",
    pathContext?: string
  ) {
    super(environment, label, jobUrl, jobScope, color, isWatched, isPinned);
    applyActivityPresentation(this, label, jobUrl, group, pathContext, color, isWatched, isPinned);
  }
}

export class ActivityPipelineTreeItem extends PipelineTreeItem {
  constructor(
    environment: JenkinsEnvironmentRef,
    label: string,
    jobUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    color?: string,
    isWatched = false,
    isPinned = false,
    group: ActivityGroupKind = "running",
    pathContext?: string
  ) {
    super(environment, label, jobUrl, jobScope, color, isWatched, isPinned);
    applyActivityPresentation(this, label, jobUrl, group, pathContext, color, isWatched, isPinned);
  }
}

export class StalePinnedJobTreeItem extends vscode.TreeItem {
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    public readonly jobKind: "job" | "pipeline" = "job"
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `stale-pinned:${environment.scope}:${environment.environmentId}:${jobUrl}`;
    this.contextValue = "stalePinnedItem pinned";
    const pathContext = formatPinnedJobPathContext(jobUrl);
    this.description = pathContext
      ? `${pathContext} • Missing from Jenkins`
      : "Missing from Jenkins";
    this.tooltip = formatPinnedJobTooltip(
      label,
      jobUrl,
      "Pinned entry no longer resolves in Jenkins."
    );
    this.iconPath = WARNING_ICON;
  }
}

function buildActivityDescription(
  pathContext: string | undefined,
  color: string | undefined,
  isWatched: boolean,
  isPinned: boolean
): string | undefined {
  const parts: string[] = [];
  if (pathContext) {
    parts.push(pathContext);
  }
  const statusDescription = formatJobDescription({
    status: formatJobColor(color),
    isWatched,
    isPinned
  });
  if (statusDescription) {
    parts.push(statusDescription);
  }
  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function formatActivityJobTooltip(
  label: string,
  jobUrl: string,
  pathContext?: string,
  details?: string
): string | undefined {
  const lines = [label];
  if (pathContext) {
    lines.push(pathContext);
  }
  if (details && details !== pathContext) {
    lines.push(details);
  }
  lines.push(jobUrl);
  return lines.join("\n");
}

function applyQuickAccessPresentation(
  item: JobTreeItem | PipelineTreeItem,
  label: string,
  jobUrl: string,
  color?: string,
  isWatched = false
): void {
  item.id = `quick-access:${item.id}`;
  item.description = buildPinnedQuickAccessDescription(jobUrl, color, isWatched);
  item.tooltip = formatPinnedJobTooltip(label, jobUrl, item.description);
}

function applyActivityPresentation(
  item: JobTreeItem | PipelineTreeItem,
  label: string,
  jobUrl: string,
  group: ActivityGroupKind,
  pathContext: string | undefined,
  color: string | undefined,
  isWatched: boolean,
  isPinned: boolean
): void {
  item.id = `activity:${group}:${item.id}`;
  item.description = buildActivityDescription(pathContext, color, isWatched, isPinned);
  item.tooltip = formatActivityJobTooltip(label, jobUrl, pathContext, item.description);
}

function buildPinnedQuickAccessDescription(
  jobUrl: string,
  color?: string,
  isWatched = false
): string | undefined {
  const parts: string[] = [];
  const pathContext = formatPinnedJobPathContext(jobUrl);
  const statusDescription = formatJobDescription({
    status: formatJobColor(color),
    isWatched
  });

  if (pathContext) {
    parts.push(pathContext);
  }
  if (statusDescription) {
    parts.push(statusDescription);
  }

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function buildJobContextValue(
  base: "jobItem" | "pipelineItem",
  isWatched: boolean,
  isPinned: boolean,
  isDisabled: boolean
): string {
  let contextValue = base;
  if (isPinned) {
    contextValue += " pinned";
  }
  if (isWatched) {
    contextValue += " watched";
  }
  return `${contextValue} ${isDisabled ? "disabled" : "enabled"}`;
}

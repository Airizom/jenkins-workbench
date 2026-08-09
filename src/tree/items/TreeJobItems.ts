import * as vscode from "vscode";
import type { JenkinsJobKind } from "../../jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { ActivityGroupKind } from "../ActivityTypes";
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
import {
  createViewTreeJobScope,
  ROOT_TREE_JOB_SCOPE,
  type TreeJobScope,
  withTreeJobPresentation
} from "../TreeJobScope";
import { buildEnvironmentTreeItemId } from "./TreeItemIds";

const EYE_ICON = new vscode.ThemeIcon("eye");
const FOLDER_ICON = new vscode.ThemeIcon("folder");
const GIT_BRANCH_ICON = new vscode.ThemeIcon("git-branch");
const WARNING_ICON = new vscode.ThemeIcon("warning");

export class JenkinsViewTreeItem extends vscode.TreeItem {
  static buildId(environment: JenkinsEnvironmentRef, viewUrl: string): string {
    return buildEnvironmentTreeItemId("view", environment, viewUrl);
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
    return buildEnvironmentTreeItemId("folder", environment, scope, folderUrl);
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
type JobTreeVariant = "default" | "quickAccess" | "activity";

function buildJobLikeTreeItemId(
  presentation: JobTreePresentation,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope
): string {
  return buildEnvironmentTreeItemId(presentation, environment, jobScope, jobUrl);
}

abstract class JobLikeTreeItem extends vscode.TreeItem {
  protected static readonly treeVariant: JobTreeVariant = "default";

  public readonly isWatched: boolean;
  public readonly isPinned: boolean;
  public readonly isDisabled: boolean;
  public readonly jobScope: TreeJobScope;

  protected constructor(
    presentation: JobTreePresentation,
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    color?: string,
    isWatched = false,
    isPinned?: boolean,
    group: ActivityGroupKind = "running",
    pathContext?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    const treeVariant = (new.target as typeof JobLikeTreeItem).treeVariant;
    const resolvedIsPinned = isPinned ?? treeVariant === "quickAccess";
    this.jobScope = resolveJobTreeVariantScope(treeVariant, jobScope, group);
    const contextBase = presentation === "pipeline" ? "pipelineItem" : "jobItem";
    this.isWatched = isWatched;
    this.isPinned = resolvedIsPinned;
    this.isDisabled = isJobColorDisabled(color);
    this.id = buildJobLikeTreeItemId(presentation, environment, jobUrl, this.jobScope);
    this.contextValue = buildJobContextValue(
      contextBase,
      isWatched,
      resolvedIsPinned,
      this.isDisabled
    );
    this.description = formatJobDescription({
      status: formatJobColor(color),
      isWatched,
      isPinned: resolvedIsPinned,
      isDisabled: this.isDisabled
    });
    this.iconPath = jobIcon(presentation, color);
    if (treeVariant === "quickAccess") {
      applyQuickAccessPresentation(this, label, jobUrl, color, isWatched);
    } else if (treeVariant === "activity") {
      applyActivityPresentation(
        this,
        label,
        jobUrl,
        pathContext,
        color,
        isWatched,
        resolvedIsPinned
      );
    }
  }
}

type JobTreeItemArguments = [
  environment: JenkinsEnvironmentRef,
  label: string,
  jobUrl: string,
  jobScope?: TreeJobScope,
  color?: string,
  isWatched?: boolean,
  isPinned?: boolean,
  group?: ActivityGroupKind,
  pathContext?: string
];

export class JobTreeItem extends JobLikeTreeItem {
  constructor(...args: JobTreeItemArguments) {
    super("job", ...args);
  }
}

export class PipelineTreeItem extends JobLikeTreeItem {
  constructor(...args: JobTreeItemArguments) {
    super("pipeline", ...args);
  }
}

export class QuickAccessJobTreeItem extends JobTreeItem {
  protected static override readonly treeVariant: JobTreeVariant = "quickAccess";
}

export class QuickAccessPipelineTreeItem extends PipelineTreeItem {
  protected static override readonly treeVariant: JobTreeVariant = "quickAccess";
}

export class ActivityJobTreeItem extends JobTreeItem {
  protected static override readonly treeVariant: JobTreeVariant = "activity";
}

export class ActivityPipelineTreeItem extends PipelineTreeItem {
  protected static override readonly treeVariant: JobTreeVariant = "activity";
}

function resolveJobTreeVariantScope(
  treeVariant: JobTreeVariant,
  jobScope: TreeJobScope,
  group: ActivityGroupKind
): TreeJobScope {
  if (treeVariant === "quickAccess") {
    return withTreeJobPresentation(jobScope, "pinned");
  }
  if (treeVariant === "activity") {
    return withTreeJobPresentation(jobScope, `activity:${group}`);
  }
  return jobScope;
}

export class StalePinnedJobTreeItem extends vscode.TreeItem {
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    public readonly jobKind: "job" | "pipeline" = "job"
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = buildEnvironmentTreeItemId("stale-pinned", environment, jobUrl);
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

function buildJobDescriptionWithPathContext(
  pathContext: string | undefined,
  color: string | undefined,
  isWatched: boolean,
  isPinned: boolean
): string | undefined {
  const statusDescription = formatJobDescription({
    status: formatJobColor(color),
    isWatched,
    isPinned
  });
  if (pathContext && statusDescription) {
    return `${pathContext} • ${statusDescription}`;
  }
  return pathContext || statusDescription;
}

function formatActivityJobTooltip(
  label: string,
  jobUrl: string,
  pathContext?: string,
  details?: string
): string | undefined {
  let tooltip = label;
  if (pathContext) {
    tooltip += `\n${pathContext}`;
  }
  if (details && details !== pathContext) {
    tooltip += `\n${details}`;
  }
  return `${tooltip}\n${jobUrl}`;
}

function applyQuickAccessPresentation(
  item: JobLikeTreeItem,
  label: string,
  jobUrl: string,
  color?: string,
  isWatched = false
): void {
  item.description = buildPinnedQuickAccessDescription(jobUrl, color, isWatched);
  item.tooltip = formatPinnedJobTooltip(label, jobUrl, item.description);
}

function applyActivityPresentation(
  item: JobLikeTreeItem,
  label: string,
  jobUrl: string,
  pathContext: string | undefined,
  color: string | undefined,
  isWatched: boolean,
  isPinned: boolean
): void {
  item.description = buildJobDescriptionWithPathContext(pathContext, color, isWatched, isPinned);
  item.tooltip = formatActivityJobTooltip(label, jobUrl, pathContext, item.description);
}

function buildPinnedQuickAccessDescription(
  jobUrl: string,
  color?: string,
  isWatched = false
): string | undefined {
  return buildJobDescriptionWithPathContext(
    formatPinnedJobPathContext(jobUrl),
    color,
    isWatched,
    false
  );
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

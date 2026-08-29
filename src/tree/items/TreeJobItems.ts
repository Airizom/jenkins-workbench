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

export type JobTreePresentation = "job" | "pipeline";

type JobTreeItemCommonOptions = {
  presentation: JobTreePresentation;
  environment: JenkinsEnvironmentRef;
  label: string;
  jobUrl: string;
  jobScope?: TreeJobScope;
  color?: string;
  isWatched?: boolean;
  isPinned?: boolean;
};

export type JobTreeItemOptions = JobTreeItemCommonOptions &
  (
    | { variant: "default" }
    | { variant: "quickAccess" }
    | { variant: "activity"; group: ActivityGroupKind; pathContext?: string }
  );

function buildJobTreeItemId(
  presentation: JobTreePresentation,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope
): string {
  return buildEnvironmentTreeItemId(presentation, environment, jobScope, jobUrl);
}

export class JobTreeItem extends vscode.TreeItem {
  public readonly presentation: JobTreePresentation;
  public readonly environment: JenkinsEnvironmentRef;
  public readonly jobUrl: string;
  public readonly isWatched: boolean;
  public readonly isPinned: boolean;
  public readonly isDisabled: boolean;
  public readonly jobScope: TreeJobScope;

  constructor(options: JobTreeItemOptions) {
    super(options.label, vscode.TreeItemCollapsibleState.Collapsed);
    const jobScope = options.jobScope ?? ROOT_TREE_JOB_SCOPE;
    const color = options.color;
    const isWatched = options.isWatched ?? false;
    const resolvedIsPinned = options.isPinned ?? options.variant === "quickAccess";
    if (options.variant === "quickAccess") {
      this.jobScope = withTreeJobPresentation(jobScope, "pinned");
    } else if (options.variant === "activity") {
      this.jobScope = withTreeJobPresentation(jobScope, `activity:${options.group}`);
    } else {
      this.jobScope = jobScope;
    }
    const contextBase = options.presentation === "pipeline" ? "pipelineItem" : "jobItem";
    this.presentation = options.presentation;
    this.environment = options.environment;
    this.jobUrl = options.jobUrl;
    this.isWatched = isWatched;
    this.isPinned = resolvedIsPinned;
    this.isDisabled = isJobColorDisabled(color);
    this.id = buildJobTreeItemId(
      options.presentation,
      options.environment,
      options.jobUrl,
      this.jobScope
    );
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
    this.iconPath = jobIcon(options.presentation, color);
    if (options.variant === "quickAccess") {
      this.description = buildJobDescriptionWithPathContext(
        formatPinnedJobPathContext(options.jobUrl),
        color,
        isWatched,
        false
      );
      this.tooltip = formatPinnedJobTooltip(options.label, options.jobUrl, this.description);
    } else if (options.variant === "activity") {
      this.description = buildJobDescriptionWithPathContext(
        options.pathContext,
        color,
        isWatched,
        resolvedIsPinned
      );
      this.tooltip = formatActivityJobTooltip(
        options.label,
        options.jobUrl,
        options.pathContext,
        this.description
      );
    }
  }
}

export type PipelineTreeItem = JobTreeItem;

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

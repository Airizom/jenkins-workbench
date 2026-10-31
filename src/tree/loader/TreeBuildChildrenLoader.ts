import * as vscode from "vscode";
import type { JenkinsArtifact } from "../../jenkins/JenkinsClient";
import type { BuildListFetchOptions, JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";
import type { BuildTooltipOptions } from "../BuildTooltips";
import { ArtifactTreeItem, BuildTreeItem } from "../items/TreeBuildItems";
import type { JobTreeItem, PipelineTreeItem } from "../items/TreeJobItems";
import { WorkspaceRootTreeItem } from "../items/TreeWorkspaceItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { resolveTreeItemLabel } from "../TreeItemLabels";
import type { TreeJobScope } from "../TreeJobScope";
import type { TreeChildrenKeyBuilder } from "./TreeCacheKeys";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";
import {
  buildArtifactChildrenKey,
  buildBuildArtifactsKey,
  buildBuildsChildrenKey
} from "./TreeChildrenMapping";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

const HISTORY_ICON = new vscode.ThemeIcon("history");
/** The most builds a job lists in the tree; deeper builds open by number. */
export const MAX_TREE_BUILDS = 500;
/** Jobs whose extra build pages are remembered; the job paged least recently is dropped first. */
export const REQUESTED_BUILD_COUNTS_MAX_ENTRIES = 200;

export class TreeBuildChildrenLoader {
  // Keyed by builds-children key (per tree section). Refreshes keep these counts so an expanded
  // list does not shrink while it is being read; only a window reload resets them. A cached
  // build list was always fetched with the job's current count: every change clears it.
  private readonly requestedBuildCounts = new Map<string, number>();

  /** `buildLimit` is both the first page of builds and the size of each further page. */
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly cacheManager: TreeChildrenCacheManager,
    private readonly buildChildrenKey: TreeChildrenKeyBuilder,
    private readonly buildLimit: number,
    private readonly getBuildTooltipOptions: () => BuildTooltipOptions,
    private readonly getBuildListFetchOptions: () => BuildListFetchOptions,
    private readonly placeholders: TreePlaceholderFactory
  ) {}

  async loadJobChildrenWithWorkspace(element: JobTreeItem): Promise<WorkbenchTreeElement[]> {
    const workspaceRoot = new WorkspaceRootTreeItem(
      element.environment,
      element.jobUrl,
      element.jobScope
    );
    const builds = await this.loadBuildChildren(element);
    // Builds are why people expand a job; the workspace browser is secondary.
    return [...builds, workspaceRoot];
  }

  async loadBuildChildren(
    element: JobTreeItem | PipelineTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    const key = this.buildBuildsChildrenKey(element.environment, element.jobUrl, element.jobScope);
    const items = await this.cacheManager.getOrLoadChildren(
      key,
      element,
      () => this.loadBuildsForJob(element, resolveTreeItemLabel(element)),
      "Loading builds..."
    );
    // Section reloads (Activity refreshes, Pinned, folders) replace job items while the cached
    // list survives, so the "more builds" row is added per read for the element being expanded:
    // VS Code only refreshes a fired element it rendered. Loading and error placeholders hold
    // no builds and get no row; fewer builds than requested means the history is exhausted.
    const shown = items.filter((item) => item instanceof BuildTreeItem).length;
    if (shown === 0 || shown < this.getRequestedBuildCount(key)) {
      return items;
    }
    return [...items, this.createMoreBuildsItem(element, shown)];
  }

  /**
   * Lists the next page of builds for a job. Counts are per builds-children key, which
   * includes the presentation scope, so the Jobs folder, Pinned and Activity sections page
   * independently. Clears only that key's cached children, so the caller must notify the
   * rendered job element. Returns false once the cap is reached.
   */
  loadMoreBuilds(job: JobTreeItem | PipelineTreeItem): boolean {
    const key = this.buildBuildsChildrenKey(job.environment, job.jobUrl, job.jobScope);
    const current = this.getRequestedBuildCount(key);
    if (current >= MAX_TREE_BUILDS) {
      return false;
    }
    this.setRequestedBuildCount(key, Math.min(current + this.buildLimit, MAX_TREE_BUILDS));
    this.cacheManager.clearChildrenCache(key);
    return true;
  }

  async loadArtifactsForBuild(
    build: BuildTreeItem,
    isCurrentLoad: () => boolean = () => true
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const artifacts = await this.getArtifactsForBuild(
        build.environment,
        build.buildUrl,
        build.jobScope,
        isCurrentLoad
      );
      const items: ArtifactTreeItem[] = [];
      for (const artifact of artifacts) {
        const relativePath = artifact.relativePath ?? "";
        if (!relativePath) {
          continue;
        }
        const fileName = artifact.fileName?.trim();
        items.push(
          new ArtifactTreeItem(
            build.environment,
            build.buildUrl,
            build.buildNumber,
            relativePath,
            fileName || undefined,
            build.jobNameHint
          )
        );
      }

      if (items.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No artifacts",
            "This build did not archive any artifacts."
          )
        ];
      }

      return items;
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load artifacts.", error)];
    }
  }

  buildBuildsChildrenKey(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildBuildsChildrenKey(this.buildChildrenKey, environment, jobUrl, jobScope);
  }

  buildBuildArtifactsKey(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildBuildArtifactsKey(this.buildChildrenKey, environment, buildUrl, jobScope);
  }

  buildArtifactChildrenKey(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildArtifactChildrenKey(this.buildChildrenKey, environment, buildUrl, jobScope);
  }

  private getRequestedBuildCount(key: string): number {
    return this.requestedBuildCounts.get(key) ?? this.buildLimit;
  }

  /** Re-inserts `key` as most recently paged and evicts the least recently paged job past the cap. */
  private setRequestedBuildCount(key: string, count: number): void {
    this.requestedBuildCounts.delete(key);
    this.requestedBuildCounts.set(key, count);
    if (this.requestedBuildCounts.size <= REQUESTED_BUILD_COUNTS_MAX_ENTRIES) {
      return;
    }
    const oldestKey = this.requestedBuildCounts.keys().next().value;
    if (oldestKey !== undefined) {
      // Its cached list was fetched with the forgotten count, so it goes too.
      this.requestedBuildCounts.delete(oldestKey);
      this.cacheManager.clearChildrenCache(oldestKey);
    }
  }

  private createMoreBuildsItem(
    job: JobTreeItem | PipelineTreeItem,
    shown: number
  ): WorkbenchTreeElement {
    const capped = shown >= MAX_TREE_BUILDS;
    const label = capped
      ? `Showing the ${MAX_TREE_BUILDS} most recent builds`
      : `Load ${this.buildLimit} more builds`;
    const description = capped ? "Open Build by Number…" : `Showing ${shown}`;
    const command = capped
      ? { command: "jenkinsWorkbench.openBuildByNumber", title: "Open Build by Number" }
      : { command: "jenkinsWorkbench.loadMoreBuilds", title: "Load More Builds" };
    return this.placeholders.createEmptyPlaceholder(label, description, {
      icon: HISTORY_ICON,
      command: { ...command, arguments: [job] }
    });
  }

  private async loadBuildsForJob(
    job: JobTreeItem | PipelineTreeItem,
    jobNameHint?: string
  ): Promise<WorkbenchTreeElement[]> {
    const { environment, jobUrl, jobScope } = job;
    const count = this.getRequestedBuildCount(
      this.buildBuildsChildrenKey(environment, jobUrl, jobScope)
    );
    try {
      const builds = await this.dataService.getBuildsForJob(environment, jobUrl, count, {
        ...this.getBuildListFetchOptions(),
        // Build items show descriptions in their tooltips; other build lists skip the large field.
        includeDescription: true,
        // Jenkins caps the exported `builds` list at 100; an explicit offset reads `allBuilds`.
        ...(count > this.buildLimit ? { offset: 0 } : {})
      });
      if (builds.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No builds found.",
            "This job has no build history yet."
          )
        ];
      }
      const runningBuildUrls: string[] = [];
      for (const build of builds) {
        if (build.building && build.url) {
          runningBuildUrls.push(build.url);
        }
      }
      const summariesByUrl =
        runningBuildUrls.length > 0
          ? await this.pendingInputCoordinator.getSummaries(environment, runningBuildUrls, {
              queueRefresh: true
            })
          : undefined;

      return builds.map((build) => {
        const summary = summariesByUrl?.get(build.url);
        return new BuildTreeItem(
          environment,
          build,
          jobScope,
          this.getBuildTooltipOptions(),
          jobNameHint,
          summary?.awaitingInput ?? false
        );
      });
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load builds.", error)];
    }
  }

  private async getArtifactsForBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope,
    isCurrentLoad: () => boolean
  ): Promise<JenkinsArtifact[]> {
    const key = this.buildArtifactChildrenKey(environment, buildUrl, jobScope);
    const cached = this.cacheManager.getCachedArtifacts<JenkinsArtifact[]>(key);
    if (cached) {
      return cached;
    }
    const artifacts = await this.dataService.getBuildArtifacts(environment, buildUrl);
    if (isCurrentLoad()) {
      this.cacheManager.setCachedArtifacts(key, artifacts);
    }
    return artifacts;
  }
}

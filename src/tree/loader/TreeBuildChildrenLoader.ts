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
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "../TreeJobScope";
import type { TreeChildrenKeyBuilder } from "./TreeCacheKeys";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";
import {
  buildArtifactChildrenKey,
  buildBuildArtifactsKey,
  buildBuildsChildrenKey
} from "./TreeChildrenMapping";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

const HISTORY_ICON = new vscode.ThemeIcon("history");

export class TreeBuildChildrenLoader {
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
    return await this.cacheManager.getOrLoadChildren(
      this.buildBuildsChildrenKey(element.environment, element.jobUrl, element.jobScope),
      element,
      () => this.loadBuildsForJob(element, resolveTreeItemLabel(element)),
      "Loading builds..."
    );
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
        const relativePath = (artifact.relativePath ?? "").trim();
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

  private async loadBuildsForJob(
    job: JobTreeItem | PipelineTreeItem,
    jobNameHint?: string
  ): Promise<WorkbenchTreeElement[]> {
    const { environment, jobUrl, jobScope } = job;
    try {
      const builds = await this.dataService.getBuildsForJob(
        environment,
        jobUrl,
        this.buildLimit,
        this.getBuildListFetchOptions()
      );
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

      const items: WorkbenchTreeElement[] = builds.map((build) => {
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
      if (builds.length >= this.buildLimit) {
        items.push(
          this.placeholders.createEmptyPlaceholder("Older builds…", "Open Job History", {
            icon: HISTORY_ICON,
            command: {
              command: "jenkinsWorkbench.openJobHistory",
              title: "Open Job History",
              arguments: [job]
            }
          })
        );
      }
      return items;
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load builds.", error)];
    }
  }

  private async getArtifactsForBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE,
    isCurrentLoad: () => boolean = () => true
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

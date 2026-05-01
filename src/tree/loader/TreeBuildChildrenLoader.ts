import type { JenkinsArtifact } from "../../jenkins/JenkinsClient";
import type { BuildListFetchOptions, JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";
import type { BuildTooltipOptions } from "../BuildTooltips";
import { resolveTreeItemLabel } from "../TreeItemLabels";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "../TreeJobScope";
import {
  ArtifactTreeItem,
  BuildArtifactsFolderTreeItem,
  BuildTreeItem
} from "../items/TreeBuildItems";
import type { JobTreeItem, PipelineTreeItem } from "../items/TreeJobItems";
import { WorkspaceRootTreeItem } from "../items/TreeWorkspaceItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";
import {
  buildArtifactChildrenKey,
  buildBuildArtifactsKey,
  buildBuildsChildrenKey
} from "./TreeChildrenMapping";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

export class TreeBuildChildrenLoader {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly cacheManager: TreeChildrenCacheManager,
    private readonly buildChildrenKey: (
      kind: string,
      environment: JenkinsEnvironmentRef,
      extra?: string
    ) => string,
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
    return [workspaceRoot, ...builds];
  }

  async loadBuildChildren(
    element: JobTreeItem | PipelineTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    return await this.cacheManager.getOrLoadChildren(
      this.buildBuildsChildrenKey(element.environment, element.jobUrl, element.jobScope),
      element,
      () =>
        this.loadBuildsForJob(
          element.environment,
          element.jobUrl,
          element.jobScope,
          resolveTreeItemLabel(element)
        ),
      "Loading builds..."
    );
  }

  async loadArtifactsSummaryForBuild(build: BuildTreeItem): Promise<WorkbenchTreeElement[]> {
    try {
      const artifacts = await this.getArtifactsForBuild(
        build.environment,
        build.buildUrl,
        build.jobScope
      );
      return [
        new BuildArtifactsFolderTreeItem(
          build.environment,
          build.buildUrl,
          build.buildNumber,
          build.jobScope,
          build.jobNameHint,
          artifacts.length
        )
      ];
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load artifacts.", error)];
    }
  }

  async loadArtifactsForBuild(
    folder: BuildArtifactsFolderTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const artifacts = await this.getArtifactsForBuild(
        folder.environment,
        folder.buildUrl,
        folder.jobScope
      );
      if (artifacts.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No artifacts available.",
            "This build did not produce any artifacts."
          )
        ];
      }
      const items = artifacts
        .map((artifact) => {
          const relativePath = (artifact.relativePath ?? "").trim();
          if (!relativePath) {
            return undefined;
          }
          const fileName = artifact.fileName?.trim();
          return new ArtifactTreeItem(
            folder.environment,
            folder.buildUrl,
            folder.buildNumber,
            relativePath,
            fileName || undefined,
            folder.jobNameHint
          );
        })
        .filter((item): item is ArtifactTreeItem => Boolean(item));

      if (items.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No artifacts available.",
            "This build did not produce any artifacts."
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
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    jobNameHint?: string
  ): Promise<WorkbenchTreeElement[]> {
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
      const runningBuilds = builds.filter((build) => Boolean(build.building) && build.url);
      const summariesByUrl = await this.pendingInputCoordinator.getSummaries(
        environment,
        runningBuilds.map((build) => build.url),
        { queueRefresh: true }
      );

      return builds.map((build) => {
        const summary = summariesByUrl.get(build.url);
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
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE
  ): Promise<JenkinsArtifact[]> {
    const key = this.buildArtifactChildrenKey(environment, buildUrl, jobScope);
    const cached = this.cacheManager.getCachedArtifacts<JenkinsArtifact[]>(key);
    if (cached) {
      return cached;
    }
    const artifacts = await this.dataService.getBuildArtifacts(environment, buildUrl);
    this.cacheManager.setCachedArtifacts(key, artifacts);
    return artifacts;
  }
}

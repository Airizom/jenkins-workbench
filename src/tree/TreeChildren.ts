import { formatScopeLabel } from "../formatters/ScopeFormatters";
import {
  ArtifactTreeItem,
  BuildArtifactsFolderTreeItem,
  BuildQueueFolderTreeItem,
  BuildTreeItem,
  EnvironmentGroupTreeItem,
  InstanceTreeItem,
  JenkinsFolderTreeItem,
  JobTreeItem,
  JobsFolderTreeItem,
  NodeTreeItem,
  NodesFolderTreeItem,
  PipelineTreeItem,
  PlaceholderTreeItem,
  QueueItemTreeItem,
  RootSectionTreeItem,
  SettingsEnvironmentTreeItem,
  SettingsEnvironmentsTreeItem,
  type WorkbenchTreeElement
} from "./TreeItems";
import type { JenkinsJobKind } from "../jenkins/JenkinsClient";
import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JenkinsJobInfo,
  JenkinsQueueItemInfo
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { BuildTooltipOptions } from "./BuildTooltips";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { JenkinsTreeFilter } from "./TreeFilter";
import type { TreeChildrenOptions } from "./TreeTypes";

export class JenkinsTreeChildrenLoader {
  private readonly watchedUrlsCache = new Map<string, Set<string>>();
  private readonly pinnedUrlsCache = new Map<string, Set<string>>();

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly watchStore: JenkinsWatchStore,
    private readonly pinStore: JenkinsPinStore,
    private readonly treeFilter: JenkinsTreeFilter,
    private readonly buildLimit: number,
    private buildTooltipOptions: BuildTooltipOptions,
    private buildListFetchOptions: BuildListFetchOptions,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator
  ) {}

  updateBuildTooltipOptions(options: BuildTooltipOptions): void {
    this.buildTooltipOptions = options;
  }

  updateBuildListFetchOptions(options: BuildListFetchOptions): void {
    this.buildListFetchOptions = options;
  }

  async getChildren(
    element?: WorkbenchTreeElement,
    options?: TreeChildrenOptions
  ): Promise<WorkbenchTreeElement[]> {
    if (!element) {
      const environments = await this.store.listEnvironmentsWithScope();
      if (environments.length === 0) {
        return [];
      }
      return [
        new RootSectionTreeItem("Jenkins Instances", "instances"),
        new RootSectionTreeItem("Settings", "settings")
      ];
    }

    if (element instanceof RootSectionTreeItem) {
      if (element.section === "instances") {
        return await this.getInstanceItems();
      }
      return [new SettingsEnvironmentsTreeItem()];
    }

    if (element instanceof SettingsEnvironmentsTreeItem) {
      return [
        new EnvironmentGroupTreeItem("Workspace", "workspace"),
        new EnvironmentGroupTreeItem("Global", "global")
      ];
    }

    if (element instanceof EnvironmentGroupTreeItem) {
      return await this.getEnvironmentGroupItems(element);
    }

    if (element instanceof InstanceTreeItem) {
      return [
        new JobsFolderTreeItem(element),
        new BuildQueueFolderTreeItem(element),
        new NodesFolderTreeItem(element)
      ];
    }

    if (element instanceof JobsFolderTreeItem) {
      return await this.loadJobsForEnvironment(element.environment, options?.overrideKeys);
    }

    if (element instanceof JenkinsFolderTreeItem) {
      return await this.loadJobsForFolder(
        element.environment,
        element.folderUrl,
        element.folderKind,
        options?.overrideKeys
      );
    }

    if (element instanceof JobTreeItem || element instanceof PipelineTreeItem) {
      return await this.loadBuildsForJob(
        element.environment,
        element.jobUrl,
        getTreeItemLabel(element.label)
      );
    }

    if (element instanceof BuildTreeItem) {
      return [
        new BuildArtifactsFolderTreeItem(
          element.environment,
          element.buildUrl,
          element.buildNumber,
          element.jobNameHint
        )
      ];
    }

    if (element instanceof BuildArtifactsFolderTreeItem) {
      return await this.loadArtifactsForBuild(element);
    }

    if (element instanceof NodesFolderTreeItem) {
      return await this.loadNodes(element.environment);
    }

    if (element instanceof BuildQueueFolderTreeItem) {
      return await this.loadQueueForEnvironment(element.environment);
    }

    return [];
  }

  clearWatchCacheForEnvironment(environmentId?: string): void {
    if (!environmentId) {
      this.watchedUrlsCache.clear();
      return;
    }
    for (const key of this.watchedUrlsCache.keys()) {
      if (key.endsWith(`:${environmentId}`)) {
        this.watchedUrlsCache.delete(key);
      }
    }
  }

  clearPinCacheForEnvironment(environmentId?: string): void {
    if (!environmentId) {
      this.pinnedUrlsCache.clear();
      return;
    }
    for (const key of this.pinnedUrlsCache.keys()) {
      if (key.endsWith(`:${environmentId}`)) {
        this.pinnedUrlsCache.delete(key);
      }
    }
  }

  private async getInstanceItems(): Promise<WorkbenchTreeElement[]> {
    const environments = await this.store.listEnvironmentsWithScope();
    if (environments.length === 0) {
      return [
        new PlaceholderTreeItem(
          "No Jenkins environments configured.",
          "Use the + command to add one.",
          "empty"
        )
      ];
    }

    return environments.map((environment) => new InstanceTreeItem(environment));
  }

  private async getEnvironmentGroupItems(
    element: EnvironmentGroupTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    const environments = await this.store.getEnvironments(element.scope);
    if (environments.length === 0) {
      return [
        new PlaceholderTreeItem(
          "No environments stored.",
          `Add one to ${formatScopeLabel(element.scope)}.`,
          "empty"
        )
      ];
    }

    return environments.map(
      (environment) =>
        new SettingsEnvironmentTreeItem(
          environment.id,
          element.scope,
          environment.url,
          environment.username
        )
    );
  }

  private async loadJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    overrideKeys?: Set<string>
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const jobs = await this.dataService.getJobsForEnvironment(environment);
      return await this.mapJobsToTreeItems(environment, jobs, { overrideKeys });
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load jobs.", error)];
    }
  }

  private async loadJobsForFolder(
    environment: JenkinsEnvironmentRef,
    folderUrl: string,
    folderKind?: JenkinsJobKind,
    overrideKeys?: Set<string>
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const jobs = await this.dataService.getJobsForFolder(environment, folderUrl);
      return await this.mapJobsToTreeItems(environment, jobs, {
        parentFolderKind: folderKind,
        parentFolderUrl: folderUrl,
        overrideKeys
      });
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load folder items.", error)];
    }
  }

  private async loadBuildsForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobNameHint?: string
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const builds = await this.dataService.getBuildsForJob(
        environment,
        jobUrl,
        this.buildLimit,
        this.buildListFetchOptions
      );
      if (builds.length === 0) {
        return [
          new PlaceholderTreeItem(
            "No recent builds found.",
            `Showing the latest ${this.buildLimit} builds.`,
            "empty"
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
          this.buildTooltipOptions,
          jobNameHint,
          summary?.awaitingInput ?? false
        );
      });
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load builds.", error)];
    }
  }

  private async loadNodes(environment: JenkinsEnvironmentRef): Promise<WorkbenchTreeElement[]> {
    try {
      const nodes = await this.dataService.getNodes(environment);
      if (nodes.length === 0) {
        return [new PlaceholderTreeItem("No nodes found.", undefined, "empty")];
      }
      return nodes.map((node) => new NodeTreeItem(environment, node));
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load nodes.", error)];
    }
  }

  private async loadQueueForEnvironment(
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const items = await this.dataService.getQueueItems(environment);
      if (items.length === 0) {
        return [
          new PlaceholderTreeItem("Build queue is empty.", "No items are waiting to run.", "empty")
        ];
      }
      return this.mapQueueItemsToTreeItems(environment, items);
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load build queue.", error)];
    }
  }

  private async loadArtifactsForBuild(
    folder: BuildArtifactsFolderTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const artifacts = await this.dataService.getBuildArtifacts(
        folder.environment,
        folder.buildUrl
      );
      if (artifacts.length === 0) {
        return [new PlaceholderTreeItem("No artifacts available.", undefined, "empty")];
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
        return [new PlaceholderTreeItem("No artifacts available.", undefined, "empty")];
      }

      return items;
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load artifacts.", error)];
    }
  }

  private async mapJobsToTreeItems(
    environment: JenkinsEnvironmentRef,
    jobs: JenkinsJobInfo[],
    options?: {
      parentFolderKind?: JenkinsJobKind;
      parentFolderUrl?: string;
      overrideKeys?: Set<string>;
    }
  ): Promise<WorkbenchTreeElement[]> {
    if (jobs.length === 0) {
      return [new PlaceholderTreeItem("No jobs, folders, or pipelines found.", undefined, "empty")];
    }

    const [watchedJobs, pinnedJobs] = await Promise.all([
      this.getWatchedJobUrls(environment),
      this.getPinnedJobUrls(environment)
    ]);
    const filteredJobs = this.treeFilter.filterJobs(
      environment,
      jobs,
      options,
      options?.overrideKeys
    );

    if (filteredJobs.length === 0) {
      return [new PlaceholderTreeItem("No jobs match the current filters.", undefined, "empty")];
    }

    const orderedJobs = this.orderPinnedJobsFirst(filteredJobs, pinnedJobs);

    return orderedJobs.map((job) => {
      const isWatched = watchedJobs.has(job.url);
      const isPinned = pinnedJobs.has(job.url);
      switch (job.kind) {
        case "folder":
        case "multibranch":
          return new JenkinsFolderTreeItem(environment, job.name, job.url, job.kind);
        case "pipeline":
          return new PipelineTreeItem(
            environment,
            job.name,
            job.url,
            job.color,
            isWatched,
            isPinned
          );
        default:
          return new JobTreeItem(environment, job.name, job.url, job.color, isWatched, isPinned);
      }
    });
  }

  private async getWatchedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    const key = `${environment.scope}:${environment.environmentId}`;
    const cached = this.watchedUrlsCache.get(key);
    if (cached) {
      return cached;
    }

    const watched = await this.watchStore.getWatchedJobUrls(
      environment.scope,
      environment.environmentId
    );
    this.watchedUrlsCache.set(key, watched);
    return watched;
  }

  private async getPinnedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    const key = `${environment.scope}:${environment.environmentId}`;
    const cached = this.pinnedUrlsCache.get(key);
    if (cached) {
      return cached;
    }

    const pinned = await this.pinStore.getPinnedJobUrls(
      environment.scope,
      environment.environmentId
    );
    this.pinnedUrlsCache.set(key, pinned);
    return pinned;
  }

  private orderPinnedJobsFirst(jobs: JenkinsJobInfo[], pinnedJobs: Set<string>): JenkinsJobInfo[] {
    if (pinnedJobs.size === 0) {
      return jobs;
    }

    const pinned: JenkinsJobInfo[] = [];
    const unpinned: JenkinsJobInfo[] = [];

    for (const job of jobs) {
      const isPinnable = job.kind === "job" || job.kind === "pipeline";
      if (isPinnable && pinnedJobs.has(job.url)) {
        pinned.push(job);
      } else {
        unpinned.push(job);
      }
    }

    if (pinned.length === 0) {
      return jobs;
    }

    return [...pinned, ...unpinned];
  }

  private mapQueueItemsToTreeItems(
    environment: JenkinsEnvironmentRef,
    items: JenkinsQueueItemInfo[]
  ): WorkbenchTreeElement[] {
    return items.map((item) => new QueueItemTreeItem(environment, item));
  }

  private createErrorPlaceholder(label: string, error: unknown): PlaceholderTreeItem {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return new PlaceholderTreeItem(label, message, "error");
  }
}

function getTreeItemLabel(label: string | { label: string } | undefined): string | undefined {
  if (!label) {
    return undefined;
  }
  if (typeof label === "string") {
    return label;
  }
  return typeof label.label === "string" ? label.label : undefined;
}

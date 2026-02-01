import type { JenkinsArtifact, JenkinsJobKind } from "../jenkins/JenkinsClient";
import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JenkinsJobInfo,
  JenkinsQueueItemInfo
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import { ScopedCache } from "../services/ScopedCache";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { BuildTooltipOptions } from "./BuildTooltips";
import { EnvironmentSummaryStore } from "./EnvironmentSummaryStore";
import type { JenkinsTreeFilter } from "./TreeFilter";
import {
  ArtifactTreeItem,
  BuildArtifactsFolderTreeItem,
  BuildQueueFolderTreeItem,
  BuildTreeItem,
  InstanceTreeItem,
  JenkinsFolderTreeItem,
  JobTreeItem,
  JobsFolderTreeItem,
  NodeTreeItem,
  NodesFolderTreeItem,
  PinnedSectionTreeItem,
  PipelineTreeItem,
  PlaceholderTreeItem,
  QueueItemTreeItem,
  RootSectionTreeItem,
  type WorkbenchTreeElement
} from "./TreeItems";
import { resolveTreeItemLabel } from "./TreeItemLabels";
import type { TreeChildrenOptions } from "./TreeTypes";

const CHILDREN_CACHE_MAX_ENTRIES = 200;
const ARTIFACT_CACHE_MAX_ENTRIES = 200;
const ENVIRONMENT_SUMMARY_CACHE_MAX_ENTRIES = 100;

const CHILDREN_CACHE_TTL_MS = 30_000;
const ARTIFACT_CACHE_TTL_MS = 5 * 60_000;
const ENVIRONMENT_SUMMARY_TTL_MS = 60_000;
const CHILDREN_LOAD_TIMEOUT_MS = 35_000;

export class JenkinsTreeChildrenLoader {
  private readonly watchedUrlsCache = new Map<string, Set<string>>();
  private readonly pinnedUrlsCache = new Map<string, Set<string>>();
  private readonly childrenCache = new ScopedCache(
    CHILDREN_CACHE_TTL_MS,
    CHILDREN_CACHE_MAX_ENTRIES
  );
  private readonly pendingLoads = new Map<string, Promise<void>>();
  private readonly loadTokens = new Map<string, number>();
  private readonly artifactCache = new ScopedCache(
    ARTIFACT_CACHE_TTL_MS,
    ARTIFACT_CACHE_MAX_ENTRIES
  );
  private readonly environmentSummaryStore: EnvironmentSummaryStore;

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly watchStore: JenkinsWatchStore,
    private readonly pinStore: JenkinsPinStore,
    private readonly treeFilter: JenkinsTreeFilter,
    private readonly buildLimit: number,
    private buildTooltipOptions: BuildTooltipOptions,
    private buildListFetchOptions: BuildListFetchOptions,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly notify: (element?: WorkbenchTreeElement) => void,
    private readonly notifyEnvironment: (environment: JenkinsEnvironmentRef) => void
  ) {
    this.environmentSummaryStore = new EnvironmentSummaryStore(
      new ScopedCache(ENVIRONMENT_SUMMARY_TTL_MS, ENVIRONMENT_SUMMARY_CACHE_MAX_ENTRIES),
      this.notifyEnvironment
    );
  }

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
      return [new RootSectionTreeItem("Jenkins Instances", "instances")];
    }

    if (element instanceof RootSectionTreeItem) {
      return await this.getInstanceItems();
    }

    if (element instanceof InstanceTreeItem) {
      const summary = this.environmentSummaryStore.get(element);
      return [
        new JobsFolderTreeItem(element, summary?.jobs),
        new BuildQueueFolderTreeItem(element, summary?.queue),
        new NodesFolderTreeItem(element, summary?.nodes)
      ];
    }

    if (element instanceof JobsFolderTreeItem) {
      if (options?.overrideKeys && options.overrideKeys.size > 0) {
        return await this.loadJobsForEnvironment(element.environment, options.overrideKeys);
      }
      return await this.getOrLoadChildren(
        this.buildChildrenKey("jobs", element.environment),
        element,
        () => this.loadJobsForEnvironment(element.environment, options?.overrideKeys),
        "Loading jobs..."
      );
    }

    if (element instanceof JenkinsFolderTreeItem) {
      if (options?.overrideKeys && options.overrideKeys.size > 0) {
        return await this.loadJobsForFolder(
          element.environment,
          element.folderUrl,
          element.folderKind,
          options.overrideKeys
        );
      }
      return await this.getOrLoadChildren(
        this.buildChildrenKey("folder", element.environment, element.folderUrl),
        element,
        () =>
          this.loadJobsForFolder(
            element.environment,
            element.folderUrl,
            element.folderKind,
            options?.overrideKeys
          ),
        "Loading folder items..."
      );
    }

    if (element instanceof JobTreeItem || element instanceof PipelineTreeItem) {
      return await this.getOrLoadChildren(
        this.buildChildrenKey("builds", element.environment, element.jobUrl),
        element,
        () =>
          this.loadBuildsForJob(
            element.environment,
            element.jobUrl,
            resolveTreeItemLabel(element)
          ),
        "Loading builds..."
      );
    }

    if (element instanceof BuildTreeItem) {
      return await this.getOrLoadChildren(
        this.buildChildrenKey("build-artifacts", element.environment, element.buildUrl),
        element,
        () => this.loadArtifactsSummaryForBuild(element),
        "Loading artifacts..."
      );
    }

    if (element instanceof BuildArtifactsFolderTreeItem) {
      return await this.getOrLoadChildren(
        this.buildChildrenKey("artifacts", element.environment, element.buildUrl),
        element,
        () => this.loadArtifactsForBuild(element),
        "Loading artifacts..."
      );
    }

    if (element instanceof NodesFolderTreeItem) {
      return await this.getOrLoadChildren(
        this.buildChildrenKey("nodes", element.environment),
        element,
        () => this.loadNodes(element.environment),
        "Loading nodes..."
      );
    }

    if (element instanceof BuildQueueFolderTreeItem) {
      return await this.getOrLoadChildren(
        this.buildChildrenKey("queue", element.environment),
        element,
        () => this.loadQueueForEnvironment(element.environment),
        "Loading build queue..."
      );
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

  clearChildrenCacheForEnvironment(environmentId?: string): void {
    if (!environmentId) {
      this.childrenCache.clear();
      this.pendingLoads.clear();
      this.loadTokens.clear();
      this.artifactCache.clear();
      this.environmentSummaryStore.clearAll();
      return;
    }
    const prefix = `${environmentId}:`;
    for (const key of this.pendingLoads.keys()) {
      if (key.startsWith(prefix)) {
        this.clearChildrenCache(key);
      }
    }
    for (const key of this.loadTokens.keys()) {
      if (key.startsWith(prefix) && !this.pendingLoads.has(key)) {
        this.loadTokens.delete(key);
      }
    }
    this.childrenCache.clearForEnvironment(environmentId);
    this.artifactCache.clearForEnvironment(environmentId);
    this.environmentSummaryStore.clearForEnvironment(environmentId);
  }

  clearQueueCache(environment: JenkinsEnvironmentRef): void {
    const key = this.buildChildrenKey("queue", environment);
    this.clearChildrenCache(key);
  }

  clearBuildsCache(environment: JenkinsEnvironmentRef): void {
    this.clearChildrenCacheForKind(environment, "builds");
  }

  invalidateForElement(element?: WorkbenchTreeElement): void {
    if (!element) {
      this.clearChildrenCacheForEnvironment();
      return;
    }

    if (element instanceof RootSectionTreeItem) {
      this.clearChildrenCacheForEnvironment();
      return;
    }

    if (element instanceof InstanceTreeItem) {
      this.clearChildrenCacheForEnvironment(element.environmentId);
      return;
    }

    if (element instanceof JobsFolderTreeItem) {
      this.clearChildrenCache(this.buildChildrenKey("jobs", element.environment));
      return;
    }

    if (element instanceof JenkinsFolderTreeItem) {
      this.clearChildrenCache(
        this.buildChildrenKey("folder", element.environment, element.folderUrl)
      );
      return;
    }

    if (element instanceof JobTreeItem || element instanceof PipelineTreeItem) {
      this.clearChildrenCache(this.buildChildrenKey("builds", element.environment, element.jobUrl));
      return;
    }

    if (element instanceof BuildTreeItem) {
      this.clearChildrenCache(
        this.buildChildrenKey("build-artifacts", element.environment, element.buildUrl)
      );
      this.artifactCache.delete(
        this.buildChildrenKey("artifacts", element.environment, element.buildUrl)
      );
      return;
    }

    if (element instanceof BuildArtifactsFolderTreeItem) {
      this.clearChildrenCache(
        this.buildChildrenKey("artifacts", element.environment, element.buildUrl)
      );
      this.artifactCache.delete(
        this.buildChildrenKey("artifacts", element.environment, element.buildUrl)
      );
      return;
    }

    if (element instanceof NodesFolderTreeItem) {
      this.clearChildrenCache(this.buildChildrenKey("nodes", element.environment));
      return;
    }

    if (element instanceof NodeTreeItem) {
      this.clearChildrenCache(this.buildChildrenKey("nodes", element.environment));
      return;
    }

    if (element instanceof BuildQueueFolderTreeItem) {
      this.clearQueueCache(element.environment);
      return;
    }

    if (element instanceof QueueItemTreeItem) {
      this.clearQueueCache(element.environment);
      return;
    }
  }

  private clearChildrenCache(key: string): void {
    const hadPending = this.pendingLoads.has(key);
    this.childrenCache.delete(key);
    this.pendingLoads.delete(key);
    if (hadPending) {
      this.bumpLoadToken(key);
    } else {
      this.loadTokens.delete(key);
    }
  }

  private clearChildrenCacheForKind(environment: JenkinsEnvironmentRef, kind: string): void {
    const prefix = `${this.childrenCache.buildEnvironmentKey(environment)}:${kind}:`;
    for (const key of this.pendingLoads.keys()) {
      if (key.startsWith(prefix)) {
        this.clearChildrenCache(key);
      }
    }
    this.childrenCache.clearForEnvironmentKind(environment, kind);
  }

  private async getInstanceItems(): Promise<WorkbenchTreeElement[]> {
    const environments = await this.store.listEnvironmentsWithScope();
    if (environments.length === 0) {
      return [
        this.createEmptyPlaceholder(
          "No Jenkins environments configured.",
          "Use the + command to add one."
        )
      ];
    }

    return environments.map((environment) => new InstanceTreeItem(environment));
  }

  private async loadJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    overrideKeys?: Set<string>
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const jobs = await this.dataService.getJobsForEnvironment(environment);
      this.environmentSummaryStore.updateFromJobs(environment, jobs);
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
          this.createEmptyPlaceholder("No builds found.", "This job has no build history yet.")
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
      this.environmentSummaryStore.updateFromNodes(environment, nodes);
      if (nodes.length === 0) {
        return [
          this.createEmptyPlaceholder("No nodes found.", "This instance has no build agents.")
        ];
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
      this.environmentSummaryStore.updateFromQueue(environment, items);
      if (items.length === 0) {
        return [
          this.createEmptyPlaceholder("Build queue is empty.", "No items are waiting to run.")
        ];
      }
      return this.mapQueueItemsToTreeItems(environment, items);
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load build queue.", error)];
    }
  }

  private async loadArtifactsSummaryForBuild(
    build: BuildTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const artifacts = await this.getArtifactsForBuild(build.environment, build.buildUrl);
      return [
        new BuildArtifactsFolderTreeItem(
          build.environment,
          build.buildUrl,
          build.buildNumber,
          build.jobNameHint,
          artifacts.length
        )
      ];
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load artifacts.", error)];
    }
  }

  private async loadArtifactsForBuild(
    folder: BuildArtifactsFolderTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const artifacts = await this.getArtifactsForBuild(folder.environment, folder.buildUrl);
      if (artifacts.length === 0) {
        return [
          this.createEmptyPlaceholder(
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
          this.createEmptyPlaceholder(
            "No artifacts available.",
            "This build did not produce any artifacts."
          )
        ];
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
      return [
        this.createEmptyPlaceholder(
          "No jobs, folders, or pipelines found.",
          "This location is empty."
        )
      ];
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
      return [
        this.createEmptyPlaceholder(
          "No jobs match the current filters.",
          "Adjust or clear filters via the filter menu."
        )
      ];
    }

    const orderedJobs = this.orderPinnedJobsFirst(filteredJobs, pinnedJobs);
    const pinnedItems: WorkbenchTreeElement[] = [];
    const unpinnedItems: WorkbenchTreeElement[] = [];

    for (const job of orderedJobs) {
      const isWatched = watchedJobs.has(job.url);
      const isPinned = pinnedJobs.has(job.url);
      let item: WorkbenchTreeElement;
      switch (job.kind) {
        case "folder":
        case "multibranch":
          item = new JenkinsFolderTreeItem(environment, job.name, job.url, job.kind, {
            branchFilter:
              job.kind === "multibranch"
                ? this.treeFilter.getBranchFilter(environment.environmentId, job.url)
                : undefined
          });
          break;
        case "pipeline":
          item = new PipelineTreeItem(
            environment,
            job.name,
            job.url,
            job.color,
            isWatched,
            isPinned
          );
          break;
        default:
          item = new JobTreeItem(environment, job.name, job.url, job.color, isWatched, isPinned);
          break;
      }
      if (isPinned && (item instanceof JobTreeItem || item instanceof PipelineTreeItem)) {
        pinnedItems.push(item);
      } else {
        unpinnedItems.push(item);
      }
    }

    if (pinnedItems.length > 0) {
      return [new PinnedSectionTreeItem(), ...pinnedItems, ...unpinnedItems];
    }

    return [...pinnedItems, ...unpinnedItems];
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

  private async getOrLoadChildren(
    key: string,
    element: WorkbenchTreeElement,
    loader: () => Promise<WorkbenchTreeElement[]>,
    loadingLabel: string
  ): Promise<WorkbenchTreeElement[]> {
    const cached = this.childrenCache.get<WorkbenchTreeElement[]>(key);
    if (cached) {
      return cached;
    }

    if (this.pendingLoads.has(key)) {
      return [this.createLoadingPlaceholder(loadingLabel)];
    }

    const token = this.nextLoadToken(key);
    const pending = this.withTimeout(
      loader(),
      CHILDREN_LOAD_TIMEOUT_MS,
      "Loading timed out. Try refreshing the tree."
    )
      .then((items) => {
        if (!this.isCurrentLoadToken(key, token)) {
          return;
        }
        this.childrenCache.set(key, items);
      })
      .catch((error) => {
        if (!this.isCurrentLoadToken(key, token)) {
          return;
        }
        const items = [this.createErrorPlaceholder("Unable to load data.", error)];
        this.childrenCache.set(key, items);
      })
      .finally(() => {
        if (this.pendingLoads.get(key) === pending) {
          this.pendingLoads.delete(key);
        }
        if (this.isCurrentLoadToken(key, token)) {
          this.notify(element);
        }
        if (!this.pendingLoads.has(key)) {
          this.loadTokens.delete(key);
        }
      });

    this.pendingLoads.set(key, pending);
    return [this.createLoadingPlaceholder(loadingLabel)];
  }

  private async getArtifactsForBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsArtifact[]> {
    const key = this.buildChildrenKey("artifacts", environment, buildUrl);
    const cached = this.artifactCache.get<JenkinsArtifact[]>(key);
    if (cached) {
      return cached;
    }
    const artifacts = await this.dataService.getBuildArtifacts(environment, buildUrl);
    this.artifactCache.set(key, artifacts);
    return artifacts;
  }

  private buildChildrenKey(
    kind: string,
    environment: JenkinsEnvironmentRef,
    extra?: string
  ): string {
    return this.childrenCache.buildKey(environment, kind, extra);
  }

  private nextLoadToken(key: string): number {
    const next = (this.loadTokens.get(key) ?? 0) + 1;
    this.loadTokens.set(key, next);
    return next;
  }

  private bumpLoadToken(key: string): void {
    this.nextLoadToken(key);
  }

  private isCurrentLoadToken(key: string, token: number): boolean {
    return this.loadTokens.get(key) === token;
  }

  private createLoadingPlaceholder(label: string): PlaceholderTreeItem {
    return new PlaceholderTreeItem(label, undefined, "loading");
  }

  private createErrorPlaceholder(label: string, error: unknown): PlaceholderTreeItem {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return new PlaceholderTreeItem(label, message, "error");
  }

  private createEmptyPlaceholder(label: string, description?: string): PlaceholderTreeItem {
    return new PlaceholderTreeItem(label, description, "empty");
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return promise;
    }
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }
}

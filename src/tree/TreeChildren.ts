import type {
  JenkinsArtifact,
  JenkinsJobKind,
  JenkinsWorkspaceEntry
} from "../jenkins/JenkinsClient";
import type {
  BuildListFetchOptions,
  JenkinsJobCollectionRequest as JenkinsDataJobCollectionRequest,
  JenkinsDataService,
  JenkinsJobInfo,
  JenkinsQueueItemInfo
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { JenkinsActionError, JenkinsRequestError } from "../jenkins/errors";
import { canonicalizeJobUrlForEnvironment } from "../jenkins/urls";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import { ScopedCache } from "../services/ScopedCache";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore, StoredPinnedJobEntry } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { BuildTooltipOptions } from "./BuildTooltips";
import { EnvironmentSummaryStore, type EnvironmentSummaryTotals } from "./EnvironmentSummaryStore";
import type { JenkinsTreeFilter } from "./TreeFilter";
import { resolveTreeItemLabel } from "./TreeItemLabels";
import {
  ROOT_TREE_JOB_SCOPE,
  type TreeJobCollectionRequest,
  type TreeJobScope
} from "./TreeJobScope";
import type { TreeChildrenOptions } from "./TreeTypes";
import { type TreeViewCurationOptions, curateTreeViews } from "./TreeViewCuration";
import {
  ArtifactTreeItem,
  BuildArtifactsFolderTreeItem,
  BuildTreeItem
} from "./items/TreeBuildItems";
import {
  JenkinsFolderTreeItem,
  JenkinsViewTreeItem,
  JobTreeItem,
  PipelineTreeItem,
  QuickAccessJobTreeItem,
  QuickAccessPipelineTreeItem,
  StalePinnedJobTreeItem
} from "./items/TreeJobItems";
import { NodeTreeItem } from "./items/TreeNodeItems";
import { PlaceholderTreeItem } from "./items/TreePlaceholderItem";
import { QueueItemTreeItem } from "./items/TreeQueueItems";
import {
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  JobsFolderTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  RootSectionTreeItem,
  ViewsFolderTreeItem
} from "./items/TreeRootItems";
import {
  WorkspaceDirectoryTreeItem,
  WorkspaceFileTreeItem,
  WorkspaceRootTreeItem
} from "./items/TreeWorkspaceItems";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";
import { TreeChildrenCacheManager } from "./loader/TreeChildrenCacheManager";
import {
  type JobCollectionTreeElement,
  buildArtifactChildrenKey,
  buildBuildArtifactsKey,
  buildBuildsChildrenKey,
  buildJobCollectionChildrenKey,
  buildWorkspaceDirectoryChildrenKey,
  buildWorkspaceRootChildrenKey,
  getJobCollectionElement,
  getJobCollectionLoadingLabel,
  getJobCollectionRequest,
  mapJobsToTreeItems,
  mapQueueItemsToTreeItems,
  toJenkinsJobCollectionRequest
} from "./loader/TreeChildrenMapping";

const CHILDREN_CACHE_MAX_ENTRIES = 200;
const ARTIFACT_CACHE_MAX_ENTRIES = 200;
const ENVIRONMENT_SUMMARY_CACHE_MAX_ENTRIES = 100;

const CHILDREN_CACHE_TTL_MS = 30_000;
const ARTIFACT_CACHE_TTL_MS = 5 * 60_000;
const ENVIRONMENT_SUMMARY_TTL_MS = 60_000;
const CHILDREN_LOAD_TIMEOUT_MS = 35_000;
const PINNED_ITEM_LOOKUP_CONCURRENCY = 4;

export class JenkinsTreeChildrenLoader {
  private readonly childrenCache = new ScopedCache(
    CHILDREN_CACHE_TTL_MS,
    CHILDREN_CACHE_MAX_ENTRIES
  );
  private readonly artifactCache = new ScopedCache(
    ARTIFACT_CACHE_TTL_MS,
    ARTIFACT_CACHE_MAX_ENTRIES
  );
  private readonly cacheManager: TreeChildrenCacheManager;
  private readonly environmentSummaryStore: EnvironmentSummaryStore;

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly watchStore: JenkinsWatchStore,
    private readonly pinStore: JenkinsPinStore,
    private readonly treeFilter: JenkinsTreeFilter,
    private viewCurationOptions: TreeViewCurationOptions,
    private readonly buildLimit: number,
    private buildTooltipOptions: BuildTooltipOptions,
    private buildListFetchOptions: BuildListFetchOptions,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly notify: (element?: WorkbenchTreeElement) => void,
    private readonly notifyEnvironment: (environment: JenkinsEnvironmentRef) => void
  ) {
    this.cacheManager = new TreeChildrenCacheManager(
      this.childrenCache,
      this.artifactCache,
      this.notify,
      CHILDREN_LOAD_TIMEOUT_MS,
      this.createLoadingPlaceholder.bind(this),
      this.createErrorPlaceholder.bind(this)
    );
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

  updateViewCurationOptions(options: TreeViewCurationOptions): void {
    this.viewCurationOptions = options;
  }

  getSummaryTotals(): EnvironmentSummaryTotals {
    return this.environmentSummaryStore.getTotals();
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
      const pinnedEntries = await this.pinStore.listPinnedJobsForEnvironment(
        element.scope,
        element.environmentId
      );
      return [
        ...(pinnedEntries.length > 0
          ? [new PinnedJobsFolderTreeItem(element, pinnedEntries.length)]
          : []),
        new ViewsFolderTreeItem(element),
        new JobsFolderTreeItem(element, summary?.jobs),
        new BuildQueueFolderTreeItem(element, summary?.queue),
        new NodesFolderTreeItem(element, summary?.nodes)
      ];
    }

    if (element instanceof PinnedJobsFolderTreeItem) {
      return await this.getOrLoadChildren(
        this.buildChildrenKey("pinned-root", element.environment),
        element,
        () => this.loadPinnedItemsForEnvironment(element.environment),
        "Loading pinned jobs..."
      );
    }

    if (element instanceof ViewsFolderTreeItem) {
      return await this.getOrLoadChildren(
        this.buildChildrenKey("views", element.environment),
        element,
        () => this.loadViewsForEnvironment(element.environment),
        "Loading views..."
      );
    }

    const jobCollectionElement = this.getJobCollectionElement(element);
    if (jobCollectionElement) {
      const request = this.getJobCollectionRequest(jobCollectionElement);
      const parentFolderKind =
        jobCollectionElement instanceof JenkinsFolderTreeItem
          ? jobCollectionElement.folderKind
          : undefined;
      if (options?.overrideKeys && options.overrideKeys.size > 0) {
        return await this.loadJobsForCollection(jobCollectionElement.environment, request, {
          parentFolderKind,
          overrideKeys: options.overrideKeys
        });
      }
      return await this.getOrLoadChildren(
        this.buildJobCollectionChildrenKey(jobCollectionElement.environment, request),
        jobCollectionElement,
        () =>
          this.loadJobsForCollection(jobCollectionElement.environment, request, {
            parentFolderKind,
            overrideKeys: options?.overrideKeys
          }),
        this.buildJobCollectionLoadingLabel(request)
      );
    }

    if (element instanceof JobTreeItem) {
      return await this.loadJobChildrenWithWorkspace(element);
    }

    if (element instanceof PipelineTreeItem) {
      return await this.loadBuildChildren(element);
    }

    if (element instanceof BuildTreeItem) {
      return await this.getOrLoadChildren(
        this.buildBuildArtifactsKey(element.environment, element.buildUrl, element.jobScope),
        element,
        () => this.loadArtifactsSummaryForBuild(element),
        "Loading artifacts..."
      );
    }

    if (element instanceof WorkspaceRootTreeItem) {
      return await this.getOrLoadChildren(
        this.buildWorkspaceRootChildrenKey(element.environment, element.jobUrl, element.jobScope),
        element,
        () => this.loadWorkspaceDirectory(element.environment, element.jobUrl, element.jobScope),
        "Loading workspace..."
      );
    }

    if (element instanceof WorkspaceDirectoryTreeItem) {
      return await this.getOrLoadChildren(
        this.buildWorkspaceDirectoryChildrenKey(
          element.environment,
          element.jobUrl,
          element.jobScope,
          element.relativePath
        ),
        element,
        () =>
          this.loadWorkspaceDirectory(
            element.environment,
            element.jobUrl,
            element.jobScope,
            element.relativePath
          ),
        "Loading workspace folder..."
      );
    }

    if (element instanceof BuildArtifactsFolderTreeItem) {
      return await this.getOrLoadChildren(
        this.buildArtifactChildrenKey(element.environment, element.buildUrl, element.jobScope),
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
    this.cacheManager.clearWatchCacheForEnvironment(environmentId);
  }

  clearPinCacheForEnvironment(environmentId?: string): void {
    this.cacheManager.clearPinCacheForEnvironment(environmentId);
  }

  clearChildrenCacheForEnvironment(environmentId?: string): void {
    this.cacheManager.clearChildrenCacheForEnvironment(environmentId);
    if (!environmentId) {
      this.environmentSummaryStore.clearAll();
      return;
    }
    this.environmentSummaryStore.clearForEnvironment(environmentId);
  }

  clearQueueCache(environment: JenkinsEnvironmentRef): void {
    const key = this.buildChildrenKey("queue", environment);
    this.cacheManager.clearChildrenCache(key);
  }

  clearBuildsCache(environment: JenkinsEnvironmentRef): void {
    this.cacheManager.clearChildrenCacheForKind(environment, "builds");
  }

  invalidateBuildArtifacts(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE
  ): void {
    this.cacheManager.clearChildrenCache(
      this.buildBuildArtifactsKey(environment, buildUrl, jobScope)
    );
    this.cacheManager.deleteArtifact(
      this.buildArtifactChildrenKey(environment, buildUrl, jobScope)
    );
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

    if (element instanceof ViewsFolderTreeItem) {
      this.cacheManager.clearChildrenCache(this.buildChildrenKey("views", element.environment));
      return;
    }

    if (element instanceof PinnedJobsFolderTreeItem) {
      this.cacheManager.clearChildrenCache(
        this.buildChildrenKey("pinned-root", element.environment)
      );
      return;
    }

    const jobCollectionElement = this.getJobCollectionElement(element);
    if (jobCollectionElement) {
      this.cacheManager.clearChildrenCache(
        this.buildJobCollectionChildrenKey(
          jobCollectionElement.environment,
          this.getJobCollectionRequest(jobCollectionElement)
        )
      );
      return;
    }

    if (element instanceof JobTreeItem) {
      this.cacheManager.clearChildrenCache(
        this.buildBuildsChildrenKey(element.environment, element.jobUrl, element.jobScope)
      );
      this.invalidateWorkspaceForJob(element.environment, element.jobUrl, element.jobScope);
      return;
    }

    if (element instanceof PipelineTreeItem) {
      this.cacheManager.clearChildrenCache(
        this.buildBuildsChildrenKey(element.environment, element.jobUrl, element.jobScope)
      );
      return;
    }

    if (element instanceof StalePinnedJobTreeItem) {
      this.cacheManager.clearChildrenCache(
        this.buildChildrenKey("pinned-root", element.environment)
      );
      return;
    }

    if (element instanceof BuildTreeItem) {
      this.invalidateBuildArtifacts(element.environment, element.buildUrl, element.jobScope);
      return;
    }

    if (element instanceof BuildArtifactsFolderTreeItem) {
      this.invalidateBuildArtifacts(element.environment, element.buildUrl, element.jobScope);
      this.cacheManager.clearChildrenCache(
        this.buildArtifactChildrenKey(element.environment, element.buildUrl, element.jobScope)
      );
      return;
    }

    if (element instanceof WorkspaceRootTreeItem) {
      this.invalidateWorkspaceForJob(element.environment, element.jobUrl, element.jobScope);
      return;
    }

    if (element instanceof WorkspaceDirectoryTreeItem) {
      this.cacheManager.clearWorkspaceDirectorySubtree(
        element.environment,
        element.jobUrl,
        element.jobScope,
        element.relativePath
      );
      return;
    }

    if (element instanceof NodesFolderTreeItem) {
      this.cacheManager.clearChildrenCache(this.buildChildrenKey("nodes", element.environment));
      return;
    }

    if (element instanceof NodeTreeItem) {
      this.cacheManager.clearChildrenCache(this.buildChildrenKey("nodes", element.environment));
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

  private async loadViewsForEnvironment(
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const views = curateTreeViews(
        await this.dataService.getViewsForEnvironment(environment),
        this.viewCurationOptions
      );
      if (views.length === 0) {
        return [
          this.createEmptyPlaceholder(
            "No curated views found.",
            "This instance has no curated Jenkins views."
          )
        ];
      }

      return views.map((view) => new JenkinsViewTreeItem(environment, view.name, view.url));
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load views.", error)];
    }
  }

  private async loadJobsForCollection(
    environment: JenkinsEnvironmentRef,
    request: TreeJobCollectionRequest,
    options?: {
      parentFolderKind?: JenkinsJobKind;
      overrideKeys?: Set<string>;
    }
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const jobs = await this.dataService.getJobCollection(
        environment,
        this.toJenkinsJobCollectionRequest(request)
      );
      if (!request.folderUrl && request.scope.kind === "root") {
        this.environmentSummaryStore.updateFromJobs(environment, jobs);
      }
      return await this.mapJobsToTreeItems(environment, jobs, {
        parentFolderKind: options?.parentFolderKind,
        parentFolderUrl: request.folderUrl,
        overrideKeys: options?.overrideKeys,
        jobScope: request.scope
      });
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load jobs.", error)];
    }
  }

  private async loadPinnedItemsForEnvironment(
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const [pinnedEntries, watchedJobs, pinnedJobs] = await Promise.all([
        this.pinStore.listPinnedJobsForEnvironment(environment.scope, environment.environmentId),
        this.getWatchedJobUrls(environment),
        this.getPinnedJobUrls(environment)
      ]);

      if (pinnedEntries.length === 0) {
        return [
          this.createEmptyPlaceholder(
            "No pinned jobs or pipelines.",
            "Pin a job or pipeline to keep it here for quick access."
          )
        ];
      }

      return await this.loadPinnedItems(environment, pinnedEntries, watchedJobs, pinnedJobs);
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load pinned jobs.", error)];
    }
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
          jobScope,
          this.buildTooltipOptions,
          jobNameHint,
          summary?.awaitingInput ?? false
        );
      });
    } catch (error) {
      return [this.createErrorPlaceholder("Unable to load builds.", error)];
    }
  }

  private async loadJobChildrenWithWorkspace(
    element: JobTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    const workspaceRoot = new WorkspaceRootTreeItem(
      element.environment,
      element.jobUrl,
      element.jobScope
    );
    const builds = await this.loadBuildChildren(element);
    return [workspaceRoot, ...builds];
  }

  private async loadBuildChildren(
    element: JobTreeItem | PipelineTreeItem
  ): Promise<WorkbenchTreeElement[]> {
    const builds = await this.getOrLoadChildren(
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
    return builds;
  }

  private async loadWorkspaceDirectory(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath?: string
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const entries = await this.dataService.getWorkspaceEntries(environment, jobUrl, relativePath);
      if (entries.length === 0) {
        return [
          this.createEmptyPlaceholder(
            relativePath ? "Folder is empty." : "Workspace is empty.",
            relativePath
              ? "This workspace directory has no files or folders."
              : "This job workspace has no files or folders."
          )
        ];
      }
      return this.mapWorkspaceEntriesToTreeItems(environment, jobUrl, jobScope, entries);
    } catch (error) {
      const placeholder = this.createWorkspacePlaceholderForError(error, relativePath);
      return [placeholder];
    }
  }

  private mapWorkspaceEntriesToTreeItems(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    entries: JenkinsWorkspaceEntry[]
  ): WorkbenchTreeElement[] {
    return entries.map((entry) => {
      if (entry.isDirectory) {
        return new WorkspaceDirectoryTreeItem(
          environment,
          jobUrl,
          entry.relativePath,
          entry.name,
          jobScope
        );
      }
      return new WorkspaceFileTreeItem(
        environment,
        jobUrl,
        entry.relativePath,
        entry.name,
        jobScope
      );
    });
  }

  private createWorkspacePlaceholderForError(
    error: unknown,
    relativePath?: string
  ): PlaceholderTreeItem {
    if (error instanceof JenkinsRequestError && error.statusCode === 404) {
      return this.createEmptyPlaceholder(
        relativePath ? "Directory not found." : "Workspace unavailable.",
        relativePath
          ? "This workspace directory no longer exists in Jenkins."
          : "Jenkins did not expose a current workspace for this job."
      );
    }

    return this.createErrorPlaceholder(
      relativePath ? "Unable to load workspace directory." : "Unable to load workspace.",
      error
    );
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
      return [this.createErrorPlaceholder("Unable to load artifacts.", error)];
    }
  }

  private async loadArtifactsForBuild(
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
      jobScope?: TreeJobScope;
    }
  ): Promise<WorkbenchTreeElement[]> {
    const [watchedJobs, pinnedJobs] = await Promise.all([
      this.getWatchedJobUrls(environment),
      this.getPinnedJobUrls(environment)
    ]);
    return mapJobsToTreeItems(
      environment,
      jobs,
      this.treeFilter,
      options ?? {},
      watchedJobs,
      pinnedJobs,
      (label, description) => this.createEmptyPlaceholder(label, description)
    );
  }

  private async getWatchedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    const cached = this.cacheManager.getCachedWatchedJobs(environment);
    if (cached) {
      return cached;
    }

    const watched = await this.watchStore.getWatchedJobUrls(
      environment.scope,
      environment.environmentId
    );
    this.cacheManager.setCachedWatchedJobs(environment, watched);
    return watched;
  }

  private async getPinnedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    const cached = this.cacheManager.getCachedPinnedJobs(environment);
    if (cached) {
      return cached;
    }

    const pinnedEntries = await this.pinStore.listPinnedJobsForEnvironment(
      environment.scope,
      environment.environmentId
    );
    const pinned = new Set(
      pinnedEntries.map((entry) => this.getCanonicalPinnedJobUrl(environment, entry.jobUrl))
    );
    this.cacheManager.setCachedPinnedJobs(environment, pinned);
    return pinned;
  }

  private async loadPinnedItem(
    environment: JenkinsEnvironmentRef,
    entry: StoredPinnedJobEntry,
    watchedJobs: Set<string>,
    pinnedJobs: Set<string>
  ): Promise<WorkbenchTreeElement> {
    const canonicalJobUrl = this.getCanonicalPinnedJobUrl(environment, entry.jobUrl);

    try {
      const current = await this.dataService.getJobInfo(environment, canonicalJobUrl);
      if (current.kind !== "job" && current.kind !== "pipeline") {
        return this.createStalePinnedItem(environment, entry);
      }

      await this.updatePinnedEntryUrlIfNeeded(environment, entry, canonicalJobUrl);

      const isWatched = watchedJobs.has(canonicalJobUrl);
      const isPinned = pinnedJobs.has(canonicalJobUrl);

      return current.kind === "pipeline"
        ? new QuickAccessPipelineTreeItem(
            environment,
            current.name,
            canonicalJobUrl,
            ROOT_TREE_JOB_SCOPE,
            current.color,
            isWatched,
            isPinned
          )
        : new QuickAccessJobTreeItem(
            environment,
            current.name,
            canonicalJobUrl,
            ROOT_TREE_JOB_SCOPE,
            current.color,
            isWatched,
            isPinned
          );
    } catch (error) {
      if (this.isMissingPinnedItemError(error)) {
        return this.createStalePinnedItem(environment, entry);
      }

      return this.createPinnedItemErrorPlaceholder(entry, error);
    }
  }

  private createStalePinnedItem(
    environment: JenkinsEnvironmentRef,
    entry: StoredPinnedJobEntry
  ): StalePinnedJobTreeItem {
    return new StalePinnedJobTreeItem(
      environment,
      entry.jobName ?? entry.jobUrl,
      entry.jobUrl,
      entry.jobKind ?? "job"
    );
  }

  private createPinnedItemErrorPlaceholder(
    entry: StoredPinnedJobEntry,
    error: unknown
  ): PlaceholderTreeItem {
    const label = `Unable to load ${entry.jobName ?? entry.jobUrl}`;
    return this.createErrorPlaceholder(label, error);
  }

  private isMissingPinnedItemError(error: unknown): boolean {
    if (error instanceof JenkinsActionError) {
      return error.code === "not_found";
    }

    return error instanceof JenkinsRequestError && error.statusCode === 404;
  }

  private async loadPinnedItems(
    environment: JenkinsEnvironmentRef,
    pinnedEntries: StoredPinnedJobEntry[],
    watchedJobs: Set<string>,
    pinnedJobs: Set<string>
  ): Promise<WorkbenchTreeElement[]> {
    const items: WorkbenchTreeElement[] = [];

    for (let index = 0; index < pinnedEntries.length; index += PINNED_ITEM_LOOKUP_CONCURRENCY) {
      const batch = pinnedEntries.slice(index, index + PINNED_ITEM_LOOKUP_CONCURRENCY);
      const loaded = await Promise.all(
        batch.map((entry) => this.loadPinnedItem(environment, entry, watchedJobs, pinnedJobs))
      );
      items.push(...loaded);
    }

    return items;
  }

  private getCanonicalPinnedJobUrl(environment: JenkinsEnvironmentRef, jobUrl: string): string {
    return canonicalizeJobUrlForEnvironment(environment.url, jobUrl) ?? jobUrl;
  }

  private async updatePinnedEntryUrlIfNeeded(
    environment: JenkinsEnvironmentRef,
    entry: StoredPinnedJobEntry,
    canonicalJobUrl: string
  ): Promise<void> {
    if (canonicalJobUrl === entry.jobUrl) {
      return;
    }

    try {
      await this.pinStore.updatePinUrl(
        environment.scope,
        environment.environmentId,
        entry.jobUrl,
        canonicalJobUrl,
        entry.jobName
      );
    } catch {
      // Keep rendering the pinned item even if persisting the canonical URL fails.
    }
  }

  private mapQueueItemsToTreeItems(
    environment: JenkinsEnvironmentRef,
    items: JenkinsQueueItemInfo[]
  ): WorkbenchTreeElement[] {
    return mapQueueItemsToTreeItems(environment, items);
  }

  private getJobCollectionElement(
    element: WorkbenchTreeElement
  ): JobCollectionTreeElement | undefined {
    return getJobCollectionElement(element);
  }

  private getJobCollectionRequest(element: JobCollectionTreeElement): TreeJobCollectionRequest {
    return getJobCollectionRequest(element);
  }

  private buildJobCollectionChildrenKey(
    environment: JenkinsEnvironmentRef,
    request: TreeJobCollectionRequest
  ): string {
    return buildJobCollectionChildrenKey(this.buildChildrenKey.bind(this), environment, request);
  }

  private buildJobCollectionLoadingLabel(request: TreeJobCollectionRequest): string {
    return getJobCollectionLoadingLabel(request);
  }

  private toJenkinsJobCollectionRequest(
    request: TreeJobCollectionRequest
  ): JenkinsDataJobCollectionRequest {
    return toJenkinsJobCollectionRequest(request);
  }

  private async getOrLoadChildren(
    key: string,
    element: WorkbenchTreeElement,
    loader: () => Promise<WorkbenchTreeElement[]>,
    loadingLabel: string
  ): Promise<WorkbenchTreeElement[]> {
    return this.cacheManager.getOrLoadChildren(key, element, loader, loadingLabel);
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

  private buildBuildsChildrenKey(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildBuildsChildrenKey(this.buildChildrenKey.bind(this), environment, jobUrl, jobScope);
  }

  private buildBuildArtifactsKey(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildBuildArtifactsKey(
      this.buildChildrenKey.bind(this),
      environment,
      buildUrl,
      jobScope
    );
  }

  private buildArtifactChildrenKey(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildArtifactChildrenKey(
      this.buildChildrenKey.bind(this),
      environment,
      buildUrl,
      jobScope
    );
  }

  private buildWorkspaceRootChildrenKey(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildWorkspaceRootChildrenKey(
      this.buildChildrenKey.bind(this),
      environment,
      jobUrl,
      jobScope
    );
  }

  private buildWorkspaceDirectoryChildrenKey(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath: string
  ): string {
    return buildWorkspaceDirectoryChildrenKey(
      this.buildChildrenKey.bind(this),
      environment,
      jobUrl,
      jobScope,
      relativePath
    );
  }

  private invalidateWorkspaceForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): void {
    this.cacheManager.clearWorkspaceChildrenForJob(environment, jobUrl, jobScope);
  }

  private buildChildrenKey(
    kind: string,
    environment: JenkinsEnvironmentRef,
    extra?: string
  ): string {
    return this.childrenCache.buildKey(environment, kind, extra);
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
}

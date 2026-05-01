import type { BuildListFetchOptions, JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import { ScopedCache } from "../services/ScopedCache";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { TreeActivityOptions } from "./ActivityTypes";
import type { BuildTooltipOptions } from "./BuildTooltips";
import { EnvironmentSummaryStore, type EnvironmentSummaryTotals } from "./EnvironmentSummaryStore";
import type { JenkinsTreeFilter } from "./TreeFilter";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "./TreeJobScope";
import type { TreeChildrenOptions } from "./TreeTypes";
import type { TreeViewCurationOptions } from "./TreeViewCuration";
import { ActivityCollector } from "./activity/ActivityCollector";
import { PlaceholderTreeItem } from "./items/TreePlaceholderItem";
import { RootSectionTreeItem } from "./items/TreeRootItems";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";
import { TreeActivityChildrenLoader } from "./loader/TreeActivityChildrenLoader";
import { TreeBuildChildrenLoader } from "./loader/TreeBuildChildrenLoader";
import { TreeChildrenCacheManager } from "./loader/TreeChildrenCacheManager";
import {
  ARTIFACT_CACHE_MAX_ENTRIES,
  ARTIFACT_CACHE_TTL_MS,
  CHILDREN_CACHE_MAX_ENTRIES,
  CHILDREN_CACHE_TTL_MS,
  CHILDREN_LOAD_TIMEOUT_MS,
  ENVIRONMENT_SUMMARY_CACHE_MAX_ENTRIES,
  ENVIRONMENT_SUMMARY_TTL_MS
} from "./loader/TreeChildrenConfig";
import type { TreeElementChildrenHandler } from "./loader/TreeElementChildrenHandler";
import { createTreeElementChildrenHandlers } from "./loader/TreeElementChildrenHandlers";
import { TreeEnvironmentChildrenLoader } from "./loader/TreeEnvironmentChildrenLoader";
import { TreeJobCollectionChildrenLoader } from "./loader/TreeJobCollectionChildrenLoader";
import { TreeJobUrlStateLoader } from "./loader/TreeJobUrlStateLoader";
import { TreePinnedChildrenLoader } from "./loader/TreePinnedChildrenLoader";
import { TreeWorkspaceChildrenLoader } from "./loader/TreeWorkspaceChildrenLoader";

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
  private readonly elementHandlers: TreeElementChildrenHandler[];
  private readonly activityLoader: TreeActivityChildrenLoader;
  private readonly buildLoader: TreeBuildChildrenLoader;

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    dataService: JenkinsDataService,
    watchStore: JenkinsWatchStore,
    pinStore: JenkinsPinStore,
    treeFilter: JenkinsTreeFilter,
    private viewCurationOptions: TreeViewCurationOptions,
    private activityOptions: TreeActivityOptions,
    buildLimit: number,
    private buildTooltipOptions: BuildTooltipOptions,
    private buildListFetchOptions: BuildListFetchOptions,
    pendingInputCoordinator: PendingInputRefreshCoordinator,
    notify: (element?: WorkbenchTreeElement) => void,
    notifyEnvironment: (environment: JenkinsEnvironmentRef) => void
  ) {
    this.cacheManager = new TreeChildrenCacheManager(
      this.childrenCache,
      this.artifactCache,
      notify,
      CHILDREN_LOAD_TIMEOUT_MS,
      this.createLoadingPlaceholder.bind(this),
      this.createErrorPlaceholder.bind(this)
    );
    this.environmentSummaryStore = new EnvironmentSummaryStore(
      new ScopedCache(ENVIRONMENT_SUMMARY_TTL_MS, ENVIRONMENT_SUMMARY_CACHE_MAX_ENTRIES),
      notifyEnvironment
    );

    const placeholders = {
      createEmptyPlaceholder: this.createEmptyPlaceholder.bind(this),
      createErrorPlaceholder: this.createErrorPlaceholder.bind(this)
    };
    const buildChildrenKey = this.buildChildrenKey.bind(this);
    const jobUrlState = new TreeJobUrlStateLoader(this.cacheManager, watchStore, pinStore);
    this.activityLoader = new TreeActivityChildrenLoader(
      new ActivityCollector(dataService, pendingInputCoordinator),
      this.cacheManager,
      jobUrlState,
      buildChildrenKey,
      this.activityOptions,
      () => this.buildListFetchOptions,
      placeholders,
      notifyEnvironment
    );
    const environmentLoader = new TreeEnvironmentChildrenLoader(
      this.store,
      dataService,
      pinStore,
      this.environmentSummaryStore,
      () => this.viewCurationOptions,
      (environment) => this.activityLoader.getSummary(environment),
      placeholders
    );
    const jobCollectionLoader = new TreeJobCollectionChildrenLoader(
      dataService,
      treeFilter,
      this.environmentSummaryStore,
      this.cacheManager,
      jobUrlState,
      buildChildrenKey,
      placeholders
    );
    this.buildLoader = new TreeBuildChildrenLoader(
      dataService,
      pendingInputCoordinator,
      this.cacheManager,
      buildChildrenKey,
      buildLimit,
      () => this.buildTooltipOptions,
      () => this.buildListFetchOptions,
      placeholders
    );
    const workspaceLoader = new TreeWorkspaceChildrenLoader(
      dataService,
      buildChildrenKey,
      placeholders
    );
    const pinnedLoader = new TreePinnedChildrenLoader(
      dataService,
      pinStore,
      jobUrlState,
      placeholders
    );

    this.elementHandlers = createTreeElementChildrenHandlers({
      cacheManager: this.cacheManager,
      environmentLoader,
      activityLoader: this.activityLoader,
      jobCollectionLoader,
      buildLoader: this.buildLoader,
      workspaceLoader,
      pinnedLoader,
      buildChildrenKey,
      clearChildrenCacheForEnvironment: this.clearChildrenCacheForEnvironment.bind(this),
      clearQueueCache: this.clearQueueCache.bind(this),
      invalidateBuildArtifacts: this.invalidateBuildArtifacts.bind(this)
    });
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

  updateActivityOptions(options: TreeActivityOptions): void {
    this.activityOptions = options;
    this.activityLoader.updateOptions(options);
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

    const handler = this.getElementHandler(element);
    return (await handler?.getChildren?.(element, options)) ?? [];
  }

  clearWatchCacheForEnvironment(environmentId?: string): void {
    this.cacheManager.clearWatchCacheForEnvironment(environmentId);
  }

  clearPinCacheForEnvironment(environmentId?: string): void {
    this.cacheManager.clearPinCacheForEnvironment(environmentId);
  }

  clearChildrenCacheForEnvironment(environment?: JenkinsEnvironmentRef | string): void {
    const environmentId =
      typeof environment === "string" ? environment : environment?.environmentId;
    this.cacheManager.clearChildrenCacheForEnvironment(environmentId);
    if (!environment) {
      this.activityLoader.clearActivityData();
      this.environmentSummaryStore.clearAll();
      return;
    }
    if (typeof environment === "string") {
      this.activityLoader.clearActivityDataForEnvironmentIdAcrossScopes(environment);
    } else {
      this.activityLoader.clearActivityData(environment);
    }
    this.environmentSummaryStore.clearForEnvironment(environmentId);
  }

  clearQueueCache(environment: JenkinsEnvironmentRef): void {
    const key = this.buildChildrenKey("queue", environment);
    this.cacheManager.clearChildrenCache(key);
  }

  clearActivityCache(environment: JenkinsEnvironmentRef): void {
    this.activityLoader.clearActivityData(environment);
  }

  refreshActivityCache(environment: JenkinsEnvironmentRef): void {
    this.activityLoader.refreshActivityData(environment);
  }

  clearBuildsCache(environment: JenkinsEnvironmentRef): void {
    this.cacheManager.clearChildrenCacheForKind(environment, "builds");
  }

  clearPendingInputDependentCaches(environment: JenkinsEnvironmentRef): void {
    this.clearBuildsCache(environment);
    this.activityLoader.clearActivityData(environment);
  }

  invalidateBuildArtifacts(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: TreeJobScope = ROOT_TREE_JOB_SCOPE
  ): void {
    this.cacheManager.clearChildrenCache(
      this.buildLoader.buildBuildArtifactsKey(environment, buildUrl, jobScope)
    );
    this.cacheManager.deleteArtifact(
      this.buildLoader.buildArtifactChildrenKey(environment, buildUrl, jobScope)
    );
  }

  invalidateForElement(element?: WorkbenchTreeElement): void {
    if (!element) {
      this.clearChildrenCacheForEnvironment();
      return;
    }

    this.getElementHandler(element)?.invalidate?.(element);
  }

  private getElementHandler(element: WorkbenchTreeElement): TreeElementChildrenHandler | undefined {
    return this.elementHandlers.find((handler) => handler.matches(element));
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

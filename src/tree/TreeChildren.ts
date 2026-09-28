import type { BuildListFetchOptions, JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import { ScopedCache } from "../services/ScopedCache";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { TreeActivityOptions } from "./ActivityTypes";
import { ActivityCollector } from "./activity/ActivityCollector";
import type { BuildTooltipOptions } from "./BuildTooltips";
import { EnvironmentSummaryStore, type EnvironmentSummaryTotals } from "./EnvironmentSummaryStore";
import { PlaceholderTreeItem, type PlaceholderTreeItemOptions } from "./items/TreePlaceholderItem";
import { InstanceTreeItem, type InstanceTreeItemIssue } from "./items/TreeRootItems";
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
import type { JenkinsTreeFilter } from "./TreeFilter";
import { ROOT_TREE_JOB_SCOPE, type TreeJobScope } from "./TreeJobScope";
import { describeTreeLoadError } from "./TreeLoadErrors";
import type { TreeViewCurationOptions } from "./TreeViewCuration";

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
  private readonly elementHandlerCache = new WeakMap<
    WorkbenchTreeElement,
    TreeElementChildrenHandler | null
  >();
  private readonly activityLoader: TreeActivityChildrenLoader;
  private readonly buildLoader: TreeBuildChildrenLoader;
  private readonly environmentLoader: TreeEnvironmentChildrenLoader;
  private readonly environmentIssues = new Map<string, InstanceTreeItemIssue>();

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
    private readonly notify: (element?: WorkbenchTreeElement) => void,
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
    this.environmentLoader = new TreeEnvironmentChildrenLoader(
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
    const workspaceLoader = new TreeWorkspaceChildrenLoader(dataService, placeholders);
    const pinnedLoader = new TreePinnedChildrenLoader(
      dataService,
      pinStore,
      jobUrlState,
      placeholders
    );

    this.elementHandlers = createTreeElementChildrenHandlers({
      cacheManager: this.cacheManager,
      environmentLoader: this.environmentLoader,
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

  async getChildren(element?: WorkbenchTreeElement): Promise<WorkbenchTreeElement[]> {
    if (!element) {
      return this.environmentLoader.getInstanceItems((environment) =>
        this.environmentIssues.get(buildEnvironmentIssueKey(environment.scope, environment.id))
      );
    }

    const handler = this.getElementHandler(element);
    const items = (await handler?.getChildren?.(element)) ?? [];
    const environment = resolveTreeElementEnvironment(element);
    if (environment) {
      this.trackErrorPlaceholders(environment, items);
    }
    return items;
  }

  private trackErrorPlaceholders(
    environment: JenkinsEnvironmentRef,
    items: WorkbenchTreeElement[]
  ): void {
    for (const item of items) {
      if (!(item instanceof PlaceholderTreeItem) || item.kind !== "error") {
        continue;
      }
      item.attachRetryCommand({
        command: "jenkinsWorkbench.refresh",
        title: "Retry",
        arguments: [
          {
            environmentId: environment.environmentId,
            scope: environment.scope,
            url: environment.url,
            username: environment.username
          } satisfies JenkinsEnvironmentRef
        ]
      });
      if (item.issue) {
        this.recordEnvironmentIssue(environment, {
          kind: item.issue,
          message: typeof item.description === "string" ? item.description : ""
        });
      }
    }
  }

  // Issues are only cleared when the environment's caches are cleared (refresh). Clearing on
  // any successful load would let one healthy folder and one failing folder re-render the
  // root against each other indefinitely.
  private recordEnvironmentIssue(
    environment: JenkinsEnvironmentRef,
    issue: InstanceTreeItemIssue
  ): void {
    const key = buildEnvironmentIssueKey(environment.scope, environment.environmentId);
    if (this.environmentIssues.get(key)?.kind === issue.kind) {
      return;
    }
    this.environmentIssues.set(key, issue);
    queueMicrotask(() => this.notify(undefined));
  }

  private clearEnvironmentIssues(environmentId?: string): void {
    if (!environmentId) {
      this.environmentIssues.clear();
      return;
    }
    for (const key of this.environmentIssues.keys()) {
      if (key.endsWith(`:${environmentId}`)) {
        this.environmentIssues.delete(key);
      }
    }
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
    this.clearEnvironmentIssues(environmentId);
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

  clearViewCache(): void {
    this.cacheManager.clearChildrenCacheForEnvironment();
    this.clearEnvironmentIssues();
    this.activityLoader.clearActivityData();
  }

  clearQueueCache(environment: JenkinsEnvironmentRef): void {
    const key = this.buildChildrenKey("queue", environment);
    this.cacheManager.clearChildrenCache(key);
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
    const artifactChildrenKey = this.buildLoader.buildArtifactChildrenKey(
      environment,
      buildUrl,
      jobScope
    );
    this.cacheManager.clearChildrenCache(artifactChildrenKey);
    this.cacheManager.deleteArtifact(artifactChildrenKey);
  }

  invalidateForElement(element?: WorkbenchTreeElement): void {
    if (!element) {
      this.clearChildrenCacheForEnvironment();
      return;
    }

    this.getElementHandler(element)?.invalidate?.(element);
  }

  private getElementHandler(element: WorkbenchTreeElement): TreeElementChildrenHandler | undefined {
    if (this.elementHandlerCache.has(element)) {
      return this.elementHandlerCache.get(element) ?? undefined;
    }
    const handler = this.elementHandlers.find((candidate) => candidate.matches(element));
    this.elementHandlerCache.set(element, handler ?? null);
    return handler;
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
    const { message, hint, issue } = describeTreeLoadError(error);
    return new PlaceholderTreeItem(label, message, "error", { hint, issue });
  }

  private createEmptyPlaceholder(
    label: string,
    description?: string,
    options?: PlaceholderTreeItemOptions
  ): PlaceholderTreeItem {
    return new PlaceholderTreeItem(label, description, "empty", options);
  }
}

function buildEnvironmentIssueKey(scope: string, environmentId: string): string {
  return `${scope}:${environmentId}`;
}

function resolveTreeElementEnvironment(
  element: WorkbenchTreeElement
): JenkinsEnvironmentRef | undefined {
  if (element instanceof InstanceTreeItem) {
    return element;
  }
  return "environment" in element ? element.environment : undefined;
}

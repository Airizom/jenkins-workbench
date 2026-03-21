import * as vscode from "vscode";
import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JobSearchEntry
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { BuildTooltipOptions } from "./BuildTooltips";
import { JenkinsTreeChildrenLoader } from "./TreeChildren";
import { TreeDataProviderExpansionResolver } from "./TreeDataProviderExpansionResolver";
import { TreeDataProviderHierarchyState } from "./TreeDataProviderHierarchyState";
import { TreeDataProviderRefreshCoordinator } from "./TreeDataProviderRefreshCoordinator";
import type { TreeRefreshWaiter } from "./TreeDataProviderRefreshCoordinator";
import { TreeDataProviderSummaryState } from "./TreeDataProviderSummaryState";
import type {
  FullEnvironmentRefreshRequest,
  InvalidateBuildArtifactsRequest,
  RefreshViewOnlyRequest,
  TreeExpansionPath,
  TreeExpansionResolveResult,
  TreeExpansionResolver,
  TreeViewSummary
} from "./TreeDataProviderTypes";
import type { JenkinsTreeFilter } from "./TreeFilter";
import { BuildQueueFolderTreeItem, type WorkbenchTreeElement } from "./TreeItems";
import type { JenkinsTreeRevealProvider } from "./TreeNavigator";
import { JenkinsTreeRevealResolver } from "./TreeRevealResolver";
import type { TreeChildrenOptions } from "./TreeTypes";
import type { TreeViewCurationOptions } from "./TreeViewCuration";

export type { TreeRefreshWaiter } from "./TreeDataProviderRefreshCoordinator";
export type {
  FullEnvironmentRefreshRequest,
  InvalidateBuildArtifactsRequest,
  RefreshViewOnlyRequest,
  TreeExpansionPath,
  TreeExpansionResolver,
  TreeExpansionResolveResult,
  TreeViewSummary
} from "./TreeDataProviderTypes";

const BUILD_LIMIT = 20;
const REFRESH_DEBOUNCE_MS = 150;
const MANUAL_REFRESH_COOLDOWN_MS = 2000;

export class JenkinsWorkbenchTreeDataProvider
  implements
    vscode.TreeDataProvider<WorkbenchTreeElement>,
    JenkinsTreeRevealProvider,
    TreeExpansionResolver,
    vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WorkbenchTreeElement | undefined
  >();
  private readonly _onDidChangeSummary = new vscode.EventEmitter<TreeViewSummary>();
  private readonly childrenLoader: JenkinsTreeChildrenLoader;
  private readonly revealResolver: JenkinsTreeRevealResolver;
  private readonly refreshCoordinator: TreeDataProviderRefreshCoordinator;
  private readonly hierarchyState: TreeDataProviderHierarchyState;
  private readonly expansionResolver: TreeDataProviderExpansionResolver;
  private readonly summaryState: TreeDataProviderSummaryState;
  private pendingInputUnsubscribe: (() => void) | undefined;

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly onDidChangeSummary = this._onDidChangeSummary.event;

  constructor(
    store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    watchStore: JenkinsWatchStore,
    pinStore: JenkinsPinStore,
    treeFilter: JenkinsTreeFilter,
    buildTooltipOptions: BuildTooltipOptions,
    buildListFetchOptions: BuildListFetchOptions,
    viewCurationOptions: TreeViewCurationOptions,
    pendingInputCoordinator: PendingInputRefreshCoordinator
  ) {
    this.hierarchyState = new TreeDataProviderHierarchyState();
    this.summaryState = new TreeDataProviderSummaryState();
    this.refreshCoordinator = new TreeDataProviderRefreshCoordinator(
      this.notifyTreeChange.bind(this),
      (ms) => vscode.window.setStatusBarMessage("$(sync) Refresh already in progress", ms)
    );

    this.pendingInputUnsubscribe = pendingInputCoordinator.onSummaryChange((change) => {
      this.childrenLoader.clearBuildsCache(change.environment);
      this.notifyElement(undefined);
    });

    this.childrenLoader = new JenkinsTreeChildrenLoader(
      store,
      dataService,
      watchStore,
      pinStore,
      treeFilter,
      viewCurationOptions,
      BUILD_LIMIT,
      buildTooltipOptions,
      buildListFetchOptions,
      pendingInputCoordinator,
      this.notifyElement.bind(this),
      this.notifyEnvironment.bind(this)
    );
    this.revealResolver = new JenkinsTreeRevealResolver(this.getChildrenInternal.bind(this));
    this.expansionResolver = new TreeDataProviderExpansionResolver(
      this.getParent.bind(this),
      this.getChildrenInternal.bind(this)
    );
  }

  dispose(): void {
    if (this.pendingInputUnsubscribe) {
      this.pendingInputUnsubscribe();
      this.pendingInputUnsubscribe = undefined;
    }
    this.refreshCoordinator.dispose();
  }

  createRefreshWaiter(): TreeRefreshWaiter {
    return this.refreshCoordinator.createRefreshWaiter();
  }

  refresh(refreshToken?: number): boolean {
    const didRefresh = this.refreshCoordinator.refresh(refreshToken, MANUAL_REFRESH_COOLDOWN_MS);
    if (!didRefresh) {
      return false;
    }

    this.dataService.clearCache();
    this.childrenLoader.clearWatchCacheForEnvironment();
    this.childrenLoader.clearPinCacheForEnvironment();
    this.childrenLoader.clearChildrenCacheForEnvironment();
    this.emitSummary();
    return true;
  }

  fullEnvironmentRefresh(request?: FullEnvironmentRefreshRequest): boolean {
    const environmentId = request?.environmentId;
    const refreshToken = request?.refreshToken;
    if (environmentId) {
      this.onEnvironmentChanged(environmentId, refreshToken);
      return true;
    }

    if (request?.trigger === "manual") {
      return this.refresh(refreshToken);
    }

    this.onEnvironmentChanged(undefined, refreshToken);
    return true;
  }

  refreshView(): void {
    this.childrenLoader.clearChildrenCacheForEnvironment();
    this.refreshCoordinator.scheduleRefresh(
      undefined,
      undefined,
      REFRESH_DEBOUNCE_MS,
      this.childrenLoader.invalidateForElement.bind(this.childrenLoader)
    );
    this.emitSummary();
  }

  refreshViewOnly(request?: RefreshViewOnlyRequest): void {
    if (request?.clearDataCache) {
      this.dataService.clearCache();
    }
    this.refreshView();
  }

  refreshElement(element?: WorkbenchTreeElement): void {
    this.childrenLoader.invalidateForElement(element);
    this._onDidChangeTreeData.fire(element);
  }

  private notifyElement(element?: WorkbenchTreeElement): void {
    this._onDidChangeTreeData.fire(element);
  }

  refreshQueueOnly(environment: JenkinsEnvironmentRef): void {
    this.childrenLoader.clearQueueCache(environment);
    const item = new BuildQueueFolderTreeItem(environment);
    this._onDidChangeTreeData.fire(item);
  }

  refreshQueueFolder(environment: JenkinsEnvironmentRef): void {
    this.refreshQueueOnly(environment);
  }

  invalidateBuildArtifacts(request: InvalidateBuildArtifactsRequest): void {
    this.childrenLoader.invalidateBuildArtifacts(
      request.environment,
      request.buildUrl,
      request.jobScope
    );
    if (request.refreshTree ?? true) {
      this.refreshCoordinator.scheduleRefresh(
        undefined,
        undefined,
        REFRESH_DEBOUNCE_MS,
        this.childrenLoader.invalidateForElement.bind(this.childrenLoader)
      );
    }
    this.emitSummary();
  }

  updateBuildTooltipOptions(options: BuildTooltipOptions): void {
    this.childrenLoader.updateBuildTooltipOptions(options);
    this.childrenLoader.clearChildrenCacheForEnvironment();
  }

  updateBuildListFetchOptions(options: BuildListFetchOptions): void {
    this.childrenLoader.updateBuildListFetchOptions(options);
    this.childrenLoader.clearChildrenCacheForEnvironment();
  }

  updateViewCurationOptions(options: TreeViewCurationOptions): void {
    this.childrenLoader.updateViewCurationOptions(options);
    this.childrenLoader.clearChildrenCacheForEnvironment();
  }

  onEnvironmentChanged(environmentId?: string, refreshToken?: number): void {
    if (environmentId) {
      this.dataService.clearCacheForEnvironment(environmentId);
      this.childrenLoader.clearWatchCacheForEnvironment(environmentId);
      this.childrenLoader.clearPinCacheForEnvironment(environmentId);
      this.childrenLoader.clearChildrenCacheForEnvironment(environmentId);
      this.hierarchyState.clearEnvironment(environmentId);
    } else {
      this.dataService.clearCache();
      this.childrenLoader.clearWatchCacheForEnvironment();
      this.childrenLoader.clearPinCacheForEnvironment();
      this.childrenLoader.clearChildrenCacheForEnvironment();
      this.hierarchyState.clearEnvironment();
    }

    this.refreshCoordinator.scheduleRefresh(
      undefined,
      refreshToken,
      REFRESH_DEBOUNCE_MS,
      this.childrenLoader.invalidateForElement.bind(this.childrenLoader)
    );
    this.emitSummary();
  }

  getTreeItem(element: WorkbenchTreeElement): vscode.TreeItem {
    return element;
  }

  setWatchErrorCount(count: number): void {
    const didUpdate = this.summaryState.setWatchErrorCount(count);
    if (!didUpdate) {
      return;
    }
    this.emitSummary();
  }

  getParent(element: WorkbenchTreeElement): vscode.ProviderResult<WorkbenchTreeElement> {
    return this.hierarchyState.getParent(element);
  }

  async buildExpansionPath(element: WorkbenchTreeElement): Promise<TreeExpansionPath | undefined> {
    return this.expansionResolver.buildExpansionPath(element);
  }

  async resolveExpansionPath(path: TreeExpansionPath): Promise<TreeExpansionResolveResult> {
    return this.expansionResolver.resolveExpansionPath(path);
  }

  async resolveJobElement(
    environment: JenkinsEnvironmentRef,
    entry: JobSearchEntry
  ): Promise<WorkbenchTreeElement | undefined> {
    return this.revealResolver.resolveJobElement(environment, entry);
  }

  async getChildren(element?: WorkbenchTreeElement): Promise<WorkbenchTreeElement[]> {
    return this.getChildrenInternal(element);
  }

  private async getChildrenInternal(
    element?: WorkbenchTreeElement,
    options?: TreeChildrenOptions
  ): Promise<WorkbenchTreeElement[]> {
    const items = await this.childrenLoader.getChildren(element, options);
    const withParent = this.hierarchyState.withParent(element, items);
    this.emitSummary();
    return withParent;
  }

  private notifyEnvironment(environment: JenkinsEnvironmentRef): void {
    const instance = this.hierarchyState.notifyEnvironmentInstance(environment);
    this.notifyElement(instance);
    this.emitSummary();
  }

  private notifyTreeChange(element?: WorkbenchTreeElement): void {
    this._onDidChangeTreeData.fire(element);
    queueMicrotask(() => {
      this.refreshCoordinator.resolvePendingRefreshWaiters();
    });
  }

  private emitSummary(): void {
    this.summaryState.emitSummary(
      this.childrenLoader.getSummaryTotals(),
      this._onDidChangeSummary.fire.bind(this._onDidChangeSummary)
    );
  }
}

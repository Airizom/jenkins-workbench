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
import type { JenkinsTreeFilter } from "./TreeFilter";
import {
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  PlaceholderTreeItem,
  RootSectionTreeItem,
  type WorkbenchTreeElement
} from "./TreeItems";
import type { JenkinsTreeRevealProvider } from "./TreeNavigator";
import { JenkinsTreeRevealResolver } from "./TreeRevealResolver";
import type { TreeChildrenOptions } from "./TreeTypes";

const BUILD_LIMIT = 20;
const REFRESH_DEBOUNCE_MS = 150;
const MANUAL_REFRESH_COOLDOWN_MS = 2000;

export type TreeViewSummary = {
  running: number;
  queue: number;
  watchErrors: number;
  hasData: boolean;
};

export type TreeExpansionPath = string[];

export type TreeExpansionResolveResult = {
  element?: WorkbenchTreeElement;
  pending: boolean;
};

export interface TreeExpansionResolver {
  buildExpansionPath(element: WorkbenchTreeElement): Promise<TreeExpansionPath | undefined>;
  resolveExpansionPath(path: TreeExpansionPath): Promise<TreeExpansionResolveResult>;
  onDidChangeTreeData: vscode.Event<WorkbenchTreeElement | undefined>;
}

export type TreeRefreshWaiter = {
  token: number;
  promise: Promise<void>;
  dispose: () => void;
};

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
  private readonly parentMap = new WeakMap<
    WorkbenchTreeElement,
    WorkbenchTreeElement | undefined
  >();
  private readonly childrenLoader: JenkinsTreeChildrenLoader;
  private readonly revealResolver: JenkinsTreeRevealResolver;
  private readonly pendingInputCoordinator: PendingInputRefreshCoordinator;
  private pendingInputUnsubscribe: (() => void) | undefined;
  private readonly instanceItems = new Map<string, InstanceTreeItem>();
  private debounceTimer: NodeJS.Timeout | undefined;
  private pendingRefreshElement: WorkbenchTreeElement | undefined | null = null;
  private lastManualRefreshAt = 0;
  private watchErrorCount = 0;
  private lastSummary: TreeViewSummary | undefined;
  private refreshWaiterToken = 0;
  private readonly refreshWaiters = new Map<number, () => void>();
  private readonly pendingRefreshWaiters = new Set<number>();

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
    pendingInputCoordinator: PendingInputRefreshCoordinator
  ) {
    this.pendingInputCoordinator = pendingInputCoordinator;
    this.pendingInputUnsubscribe = this.pendingInputCoordinator.onSummaryChange((change) => {
      this.childrenLoader.clearBuildsCache(change.environment);
      this.notifyElement(undefined);
    });
    this.childrenLoader = new JenkinsTreeChildrenLoader(
      store,
      dataService,
      watchStore,
      pinStore,
      treeFilter,
      BUILD_LIMIT,
      buildTooltipOptions,
      buildListFetchOptions,
      pendingInputCoordinator,
      this.notifyElement.bind(this),
      this.notifyEnvironment.bind(this)
    );
    this.revealResolver = new JenkinsTreeRevealResolver(this.getChildrenInternal.bind(this));
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.pendingInputUnsubscribe) {
      this.pendingInputUnsubscribe();
      this.pendingInputUnsubscribe = undefined;
    }
  }

  createRefreshWaiter(): TreeRefreshWaiter {
    this.refreshWaiterToken += 1;
    const token = this.refreshWaiterToken;
    let resolve: (() => void) | undefined;
    const promise = new Promise<void>((resolveFn) => {
      resolve = resolveFn;
    });
    this.refreshWaiters.set(token, () => {
      resolve?.();
      resolve = undefined;
    });
    return {
      token,
      promise,
      dispose: () => {
        this.resolveRefreshWaiter(token);
      }
    };
  }

  refresh(refreshToken?: number): boolean {
    const now = Date.now();
    if (now - this.lastManualRefreshAt < MANUAL_REFRESH_COOLDOWN_MS) {
      vscode.window.setStatusBarMessage(
        "$(sync) Refresh already in progress",
        MANUAL_REFRESH_COOLDOWN_MS
      );
      return false;
    }
    this.lastManualRefreshAt = now;
    this.dataService.clearCache();
    this.childrenLoader.clearWatchCacheForEnvironment();
    this.childrenLoader.clearPinCacheForEnvironment();
    this.childrenLoader.clearChildrenCacheForEnvironment();
    if (typeof refreshToken === "number") {
      this.pendingRefreshWaiters.add(refreshToken);
    }
    this.notifyTreeChange(undefined);
    this.emitSummary();
    return true;
  }

  refreshView(): void {
    this.childrenLoader.clearChildrenCacheForEnvironment();
    this.scheduleRefresh(undefined);
    this.emitSummary();
  }

  refreshElement(element?: WorkbenchTreeElement): void {
    this.childrenLoader.invalidateForElement(element);
    this._onDidChangeTreeData.fire(element);
  }

  private notifyElement(element?: WorkbenchTreeElement): void {
    this._onDidChangeTreeData.fire(element);
  }

  refreshQueueFolder(environment: JenkinsEnvironmentRef): void {
    this.childrenLoader.clearQueueCache(environment);
    const item = new BuildQueueFolderTreeItem(environment);
    this._onDidChangeTreeData.fire(item);
  }

  updateBuildTooltipOptions(options: BuildTooltipOptions): void {
    this.childrenLoader.updateBuildTooltipOptions(options);
    this.childrenLoader.clearChildrenCacheForEnvironment();
  }

  updateBuildListFetchOptions(options: BuildListFetchOptions): void {
    this.childrenLoader.updateBuildListFetchOptions(options);
    this.childrenLoader.clearChildrenCacheForEnvironment();
  }

  onEnvironmentChanged(environmentId?: string, refreshToken?: number): void {
    if (environmentId) {
      this.dataService.clearCacheForEnvironment(environmentId);
      this.childrenLoader.clearWatchCacheForEnvironment(environmentId);
      this.childrenLoader.clearPinCacheForEnvironment(environmentId);
      this.childrenLoader.clearChildrenCacheForEnvironment(environmentId);
      for (const key of this.instanceItems.keys()) {
        if (key.endsWith(`:${environmentId}`)) {
          this.instanceItems.delete(key);
        }
      }
    } else {
      this.dataService.clearCache();
      this.childrenLoader.clearWatchCacheForEnvironment();
      this.childrenLoader.clearPinCacheForEnvironment();
      this.childrenLoader.clearChildrenCacheForEnvironment();
      this.instanceItems.clear();
    }
    this.scheduleRefresh(undefined, refreshToken);
    this.emitSummary();
  }

  private scheduleRefresh(
    element: WorkbenchTreeElement | undefined,
    refreshToken?: number
  ): void {
    if (element !== undefined) {
      this.childrenLoader.invalidateForElement(element);
    }
    if (this.pendingRefreshElement === undefined && element !== undefined) {
      this.pendingRefreshElement = element;
    } else {
      this.pendingRefreshElement = undefined;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (typeof refreshToken === "number") {
      this.pendingRefreshWaiters.add(refreshToken);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const elementToRefresh = this.pendingRefreshElement;
      this.pendingRefreshElement = null;
      this.notifyTreeChange(elementToRefresh === null ? undefined : elementToRefresh);
    }, REFRESH_DEBOUNCE_MS);
  }

  getTreeItem(element: WorkbenchTreeElement): vscode.TreeItem {
    return element;
  }

  setWatchErrorCount(count: number): void {
    const next = Math.max(0, Math.floor(count));
    if (next === this.watchErrorCount) {
      return;
    }
    this.watchErrorCount = next;
    this.emitSummary();
  }

  getParent(element: WorkbenchTreeElement): vscode.ProviderResult<WorkbenchTreeElement> {
    return this.parentMap.get(element);
  }

  async buildExpansionPath(
    element: WorkbenchTreeElement
  ): Promise<TreeExpansionPath | undefined> {
    const path: string[] = [];
    let current: WorkbenchTreeElement | undefined = element;

    while (current) {
      const id = getElementId(current);
      if (!id) {
        return undefined;
      }
      path.unshift(id);
      const parent = await this.getParent(current);
      current = parent ?? undefined;
    }

    return path.length > 0 ? path : undefined;
  }

  async resolveExpansionPath(path: TreeExpansionPath): Promise<TreeExpansionResolveResult> {
    let parent: WorkbenchTreeElement | undefined = undefined;

    for (const id of path) {
      const children = await this.getChildrenInternal(parent);
      const match = children.find((child) => getElementId(child) === id);
      if (!match) {
        return {
          element: undefined,
          pending: children.some((child) => isLoadingPlaceholder(child))
        };
      }
      parent = match;
    }

    return { element: parent, pending: false };
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
    const withParent = this.withParent(element, items);
    this.emitSummary();
    return withParent;
  }

  private withParent(
    parent: WorkbenchTreeElement | undefined,
    children: WorkbenchTreeElement[]
  ): WorkbenchTreeElement[] {
    if (parent instanceof RootSectionTreeItem && parent.section === "instances") {
      this.instanceItems.clear();
    }
    for (const child of children) {
      this.parentMap.set(child, parent);
      if (child instanceof InstanceTreeItem) {
        this.instanceItems.set(this.buildEnvironmentKey(child), child);
      }
    }
    return children;
  }

  private buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.scope}:${environment.environmentId}`;
  }

  private notifyEnvironment(environment: JenkinsEnvironmentRef): void {
    const key = this.buildEnvironmentKey(environment);
    const instance = this.instanceItems.get(key);
    this.notifyElement(instance);
    this.emitSummary();
  }

  private notifyTreeChange(element?: WorkbenchTreeElement): void {
    this._onDidChangeTreeData.fire(element);
    queueMicrotask(() => {
      this.resolvePendingRefreshWaiters();
    });
  }

  private emitSummary(): void {
    const totals = this.childrenLoader.getSummaryTotals();
    const summary: TreeViewSummary = {
      running: totals.running,
      queue: totals.queue,
      watchErrors: this.watchErrorCount,
      hasData: totals.hasData || this.watchErrorCount > 0
    };
    if (this.lastSummary && areTreeViewSummariesEqual(this.lastSummary, summary)) {
      return;
    }
    this.lastSummary = summary;
    this._onDidChangeSummary.fire(summary);
  }

  private resolveRefreshWaiter(refreshToken?: number): void {
    if (typeof refreshToken !== "number") {
      return;
    }
    const waiter = this.refreshWaiters.get(refreshToken);
    if (!waiter) {
      return;
    }
    this.refreshWaiters.delete(refreshToken);
    this.pendingRefreshWaiters.delete(refreshToken);
    waiter();
  }

  private resolvePendingRefreshWaiters(): void {
    if (this.pendingRefreshWaiters.size === 0) {
      return;
    }
    const tokens = Array.from(this.pendingRefreshWaiters);
    this.pendingRefreshWaiters.clear();
    for (const token of tokens) {
      this.resolveRefreshWaiter(token);
    }
  }
}

function areTreeViewSummariesEqual(left: TreeViewSummary, right: TreeViewSummary): boolean {
  return (
    left.running === right.running &&
    left.queue === right.queue &&
    left.watchErrors === right.watchErrors &&
    left.hasData === right.hasData
  );
}

function getElementId(element: WorkbenchTreeElement): string | undefined {
  return typeof element.id === "string" && element.id.length > 0 ? element.id : undefined;
}

function isLoadingPlaceholder(element: WorkbenchTreeElement): boolean {
  return element instanceof PlaceholderTreeItem && element.kind === "loading";
}

import * as vscode from "vscode";
import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JobSearchEntry
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import { JenkinsTreeChildrenLoader } from "./TreeChildren";
import type { BuildTooltipOptions } from "./BuildTooltips";
import type { JenkinsTreeFilter } from "./TreeFilter";
import { BuildQueueFolderTreeItem, type WorkbenchTreeElement } from "./TreeItems";
import type { JenkinsTreeRevealProvider } from "./TreeNavigator";
import { JenkinsTreeRevealResolver } from "./TreeRevealResolver";
import type { TreeChildrenOptions } from "./TreeTypes";

const BUILD_LIMIT = 20;
const REFRESH_DEBOUNCE_MS = 150;
const MANUAL_REFRESH_COOLDOWN_MS = 2000;

export class JenkinsWorkbenchTreeDataProvider
  implements vscode.TreeDataProvider<WorkbenchTreeElement>, JenkinsTreeRevealProvider
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WorkbenchTreeElement | undefined
  >();
  private readonly parentMap = new WeakMap<
    WorkbenchTreeElement,
    WorkbenchTreeElement | undefined
  >();
  private readonly childrenLoader: JenkinsTreeChildrenLoader;
  private readonly revealResolver: JenkinsTreeRevealResolver;
  private debounceTimer: NodeJS.Timeout | undefined;
  private pendingRefreshElement: WorkbenchTreeElement | undefined | null = null;
  private lastManualRefreshAt = 0;

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    watchStore: JenkinsWatchStore,
    pinStore: JenkinsPinStore,
    treeFilter: JenkinsTreeFilter,
    buildTooltipOptions: BuildTooltipOptions,
    buildListFetchOptions: BuildListFetchOptions
  ) {
    this.childrenLoader = new JenkinsTreeChildrenLoader(
      store,
      dataService,
      watchStore,
      pinStore,
      treeFilter,
      BUILD_LIMIT,
      buildTooltipOptions,
      buildListFetchOptions
    );
    this.revealResolver = new JenkinsTreeRevealResolver(this.getChildrenInternal.bind(this));
  }

  refresh(): void {
    const now = Date.now();
    if (now - this.lastManualRefreshAt < MANUAL_REFRESH_COOLDOWN_MS) {
      return;
    }
    this.lastManualRefreshAt = now;
    this.dataService.clearCache();
    this.childrenLoader.clearWatchCacheForEnvironment();
    this.childrenLoader.clearPinCacheForEnvironment();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshView(): void {
    this.scheduleRefresh(undefined);
  }

  refreshElement(element: WorkbenchTreeElement): void {
    this._onDidChangeTreeData.fire(element);
  }

  refreshQueueFolder(environment: JenkinsEnvironmentRef): void {
    const item = new BuildQueueFolderTreeItem(environment);
    this._onDidChangeTreeData.fire(item);
  }

  updateBuildTooltipOptions(options: BuildTooltipOptions): void {
    this.childrenLoader.updateBuildTooltipOptions(options);
  }

  updateBuildListFetchOptions(options: BuildListFetchOptions): void {
    this.childrenLoader.updateBuildListFetchOptions(options);
  }

  onEnvironmentChanged(environmentId?: string): void {
    if (environmentId) {
      this.dataService.clearCacheForEnvironment(environmentId);
      this.childrenLoader.clearWatchCacheForEnvironment(environmentId);
      this.childrenLoader.clearPinCacheForEnvironment(environmentId);
    } else {
      this.dataService.clearCache();
      this.childrenLoader.clearWatchCacheForEnvironment();
      this.childrenLoader.clearPinCacheForEnvironment();
    }
    this.scheduleRefresh(undefined);
  }

  private scheduleRefresh(element: WorkbenchTreeElement | undefined): void {
    if (this.pendingRefreshElement === undefined && element !== undefined) {
      this.pendingRefreshElement = element;
    } else {
      this.pendingRefreshElement = undefined;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const elementToRefresh = this.pendingRefreshElement;
      this.pendingRefreshElement = null;
      this._onDidChangeTreeData.fire(elementToRefresh === null ? undefined : elementToRefresh);
    }, REFRESH_DEBOUNCE_MS);
  }

  getTreeItem(element: WorkbenchTreeElement): vscode.TreeItem {
    return element;
  }

  getParent(element: WorkbenchTreeElement): vscode.ProviderResult<WorkbenchTreeElement> {
    return this.parentMap.get(element);
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
    return this.withParent(element, items);
  }

  private withParent(
    parent: WorkbenchTreeElement | undefined,
    children: WorkbenchTreeElement[]
  ): WorkbenchTreeElement[] {
    for (const child of children) {
      this.parentMap.set(child, parent);
    }
    return children;
  }
}

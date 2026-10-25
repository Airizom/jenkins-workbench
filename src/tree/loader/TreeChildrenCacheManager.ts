import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { ScopedCache } from "../../services/ScopedCache";
import type { PlaceholderTreeItem } from "../items/TreePlaceholderItem";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { deleteTreeEnvironmentKeys } from "../TreeEnvironmentKeys";
import type { TreeJobScope } from "../TreeJobScope";
import {
  buildScopedEnvironmentKey,
  isEnvironmentScopedChildKey,
  type TreeChildrenKeyBuilder
} from "./TreeCacheKeys";
import { LOADED_CHILDREN_KEYS_MAX_ENTRIES } from "./TreeChildrenConfig";
import {
  buildWorkspaceDirectoryChildrenKey,
  buildWorkspaceDirectoryChildrenPrefix,
  buildWorkspaceDirectorySubtreePrefix,
  buildWorkspaceRootChildrenKey
} from "./TreeChildrenMapping";

class JobUrlSetCache {
  private readonly cache = new Map<string, Set<string>>();
  private generation = 0;

  async getOrLoad(
    environment: JenkinsEnvironmentRef,
    load: () => Promise<Set<string>>
  ): Promise<Set<string>> {
    const cached = this.cache.get(buildScopedEnvironmentKey(environment));
    if (cached) {
      return cached;
    }

    const generation = this.generation;
    const values = await load();
    if (generation === this.generation) {
      this.set(environment, values);
    }
    return values;
  }

  // Every write or invalidation bumps the generation so older in-flight
  // store reads cannot repopulate the cache with stale URLs.
  set(environment: JenkinsEnvironmentRef, values: Set<string>): void {
    this.generation += 1;
    this.cache.set(buildScopedEnvironmentKey(environment), values);
  }

  clearForEnvironment(environmentId?: string): void {
    this.generation += 1;
    if (!environmentId) {
      this.cache.clear();
      return;
    }
    deleteTreeEnvironmentKeys(this.cache, environmentId);
  }
}

export class TreeChildrenCacheManager {
  readonly watchedJobUrls = new JobUrlSetCache();
  readonly pinnedJobUrls = new JobUrlSetCache();
  private readonly pendingLoads = new Map<string, Promise<void>>();
  private readonly loadTokens = new Map<string, number>();
  private loadSequence = 0;
  private readonly loadedKeys = new Set<string>();
  private readonly buildChildrenKey: TreeChildrenKeyBuilder = (kind, environment, extra) =>
    this.childrenCache.buildKey(environment, kind, extra);

  constructor(
    private readonly childrenCache: ScopedCache,
    private readonly artifactCache: ScopedCache,
    private readonly notify: (element?: WorkbenchTreeElement) => void,
    private readonly timeoutMs: number,
    private readonly createLoadingPlaceholder: (label: string) => PlaceholderTreeItem,
    private readonly createErrorPlaceholder: (label: string, error: unknown) => PlaceholderTreeItem
  ) {}

  getCachedChildren<T>(key: string): T | undefined {
    return this.childrenCache.get<T>(key);
  }

  setChildren<T>(key: string, items: T[]): void {
    this.childrenCache.set(key, items);
    this.recordLoadedKey(key);
  }

  private recordLoadedKey(key: string): void {
    // Keep recent expansion history across ordinary refreshes, without retaining
    // every build or workspace directory visited for the manager's lifetime.
    this.loadedKeys.delete(key);
    this.loadedKeys.add(key);
    if (this.loadedKeys.size > LOADED_CHILDREN_KEYS_MAX_ENTRIES) {
      const oldestKey = this.loadedKeys.values().next().value;
      if (oldestKey !== undefined) {
        this.loadedKeys.delete(oldestKey);
      }
    }
  }

  getCachedArtifacts<T>(key: string): T | undefined {
    return this.artifactCache.get<T>(key);
  }

  setCachedArtifacts<T>(key: string, artifacts: T[]): void {
    this.artifactCache.set(key, artifacts);
  }

  deleteArtifact(key: string): void {
    this.artifactCache.delete(key);
  }

  clearWatchCacheForEnvironment(environmentId?: string): void {
    this.watchedJobUrls.clearForEnvironment(environmentId);
  }

  clearPinCacheForEnvironment(environmentId?: string): void {
    this.pinnedJobUrls.clearForEnvironment(environmentId);
  }

  clearChildrenCacheForEnvironment(environmentId?: string): void {
    if (!environmentId) {
      this.childrenCache.clear();
      this.pendingLoads.clear();
      this.loadTokens.clear();
      this.artifactCache.clear();
      return;
    }

    this.clearPendingAndLoadTokensForEnvironment(environmentId);
    this.childrenCache.clearForEnvironment(environmentId);
    this.artifactCache.clearForEnvironment(environmentId);
  }

  clearChildrenCacheForKind(environment: JenkinsEnvironmentRef, kind: string): void {
    const prefix = `${this.childrenCache.buildEnvironmentKey(environment)}:${kind}:`;
    this.clearPendingAndLoadTokensByPrefix(prefix);
    this.childrenCache.clearForEnvironmentKind(environment, kind);
  }

  clearWorkspaceChildrenForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): void {
    this.clearChildrenCache(
      buildWorkspaceRootChildrenKey(this.buildChildrenKey, environment, jobUrl, jobScope)
    );
    this.clearChildrenCacheByPrefix(
      buildWorkspaceDirectoryChildrenPrefix(this.buildChildrenKey, environment, jobUrl, jobScope)
    );
  }

  clearWorkspaceDirectorySubtree(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath: string
  ): void {
    this.clearChildrenCache(
      buildWorkspaceDirectoryChildrenKey(
        this.buildChildrenKey,
        environment,
        jobUrl,
        jobScope,
        relativePath
      )
    );
    this.clearChildrenCacheByPrefix(
      buildWorkspaceDirectorySubtreePrefix(
        this.buildChildrenKey,
        environment,
        jobUrl,
        jobScope,
        relativePath
      )
    );
  }

  private clearChildrenCacheByPrefix(prefix: string): void {
    this.clearPendingAndLoadTokensByPrefix(prefix);
    this.childrenCache.clearByPrefix(prefix);
  }

  private clearPendingAndLoadTokensByPrefix(prefix: string): void {
    this.clearPendingAndLoadTokensWhere((key) => key.startsWith(prefix));
  }

  private clearPendingAndLoadTokensForEnvironment(environmentId: string): void {
    this.clearPendingAndLoadTokensWhere((key) => isEnvironmentScopedChildKey(key, environmentId));
  }

  private clearPendingAndLoadTokensWhere(matches: (key: string) => boolean): void {
    for (const key of this.pendingLoads.keys()) {
      if (matches(key)) {
        this.clearChildrenCache(key);
      }
    }
    for (const key of this.loadTokens.keys()) {
      if (matches(key) && !this.pendingLoads.has(key)) {
        this.loadTokens.delete(key);
      }
    }
  }

  clearChildrenCache(key: string): void {
    const hadPending = this.pendingLoads.has(key);
    this.childrenCache.delete(key);
    this.pendingLoads.delete(key);
    if (hadPending) {
      this.nextLoadToken(key);
    } else {
      this.loadTokens.delete(key);
    }
  }

  getOrLoadChildren(
    key: string,
    element: WorkbenchTreeElement | undefined,
    loader: (isCurrentLoad: () => boolean) => Promise<WorkbenchTreeElement[]>,
    loadingLabel: string
  ): Promise<WorkbenchTreeElement[]> {
    const cached = this.childrenCache.get<WorkbenchTreeElement[]>(key);
    if (cached) {
      this.recordLoadedKey(key);
      return Promise.resolve(cached);
    }

    const existingLoad = this.pendingLoads.get(key);
    if (existingLoad) {
      return this.childrenAfterLoad(key, existingLoad, loadingLabel);
    }

    const token = this.nextLoadToken(key);
    const pending = this.withTimeout(
      loader(() => this.isCurrentLoadToken(key, token)),
      this.timeoutMs,
      "Loading timed out. Try refreshing the tree."
    )
      .then((items) => {
        if (!this.isCurrentLoadToken(key, token)) {
          return;
        }
        this.setChildren(key, items);
      })
      .catch((error) => {
        if (!this.isCurrentLoadToken(key, token)) {
          return;
        }
        const items = [this.createErrorPlaceholder("Unable to load data.", error)];
        this.setChildren(key, items);
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
    return this.childrenAfterLoad(key, pending, loadingLabel);
  }

  private async childrenAfterLoad(
    key: string,
    pending: Promise<void>,
    loadingLabel: string
  ): Promise<WorkbenchTreeElement[]> {
    if (!this.loadedKeys.has(key)) {
      return [this.createLoadingPlaceholder(loadingLabel)];
    }
    // Replacing rendered children with a placeholder makes VS Code forget expansion.
    // Let its native progress indicator cover refreshes while retaining stable IDs.
    await pending;
    return this.childrenCache.get<WorkbenchTreeElement[]>(key) ?? [];
  }

  private nextLoadToken(key: string): number {
    const next = ++this.loadSequence;
    this.loadTokens.set(key, next);
    return next;
  }

  private isCurrentLoadToken(key: string, token: number): boolean {
    return this.loadTokens.get(key) === token;
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

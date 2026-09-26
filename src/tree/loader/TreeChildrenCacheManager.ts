import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { ScopedCache } from "../../services/ScopedCache";
import type { PlaceholderTreeItem } from "../items/TreePlaceholderItem";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import type { TreeJobScope } from "../TreeJobScope";
import {
  buildScopedEnvironmentKey,
  isEnvironmentScopedChildKey,
  type TreeChildrenKeyBuilder
} from "./TreeCacheKeys";
import {
  buildWorkspaceDirectoryChildrenKey,
  buildWorkspaceDirectoryChildrenPrefix,
  buildWorkspaceDirectorySubtreePrefix,
  buildWorkspaceRootChildrenKey
} from "./TreeChildrenMapping";

export class TreeChildrenCacheManager {
  private readonly watchedUrlsCache = new Map<string, Set<string>>();
  private readonly pinnedUrlsCache = new Map<string, Set<string>>();
  private watchedUrlsGeneration = 0;
  private pinnedUrlsGeneration = 0;
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
    this.loadedKeys.add(key);
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

  getCachedWatchedJobs(environment: JenkinsEnvironmentRef): Set<string> | undefined {
    return this.watchedUrlsCache.get(buildScopedEnvironmentKey(environment));
  }

  getWatchedJobsGeneration(): number {
    return this.watchedUrlsGeneration;
  }

  setCachedWatchedJobs(environment: JenkinsEnvironmentRef, values: Set<string>): void {
    this.watchedUrlsGeneration += 1;
    this.watchedUrlsCache.set(buildScopedEnvironmentKey(environment), values);
  }

  setCachedWatchedJobsIfCurrent(
    environment: JenkinsEnvironmentRef,
    values: Set<string>,
    generation: number
  ): void {
    if (generation === this.watchedUrlsGeneration) {
      this.setCachedWatchedJobs(environment, values);
    }
  }

  getCachedPinnedJobs(environment: JenkinsEnvironmentRef): Set<string> | undefined {
    return this.pinnedUrlsCache.get(buildScopedEnvironmentKey(environment));
  }

  getPinnedJobsGeneration(): number {
    return this.pinnedUrlsGeneration;
  }

  setCachedPinnedJobs(environment: JenkinsEnvironmentRef, values: Set<string>): void {
    this.pinnedUrlsGeneration += 1;
    this.pinnedUrlsCache.set(buildScopedEnvironmentKey(environment), values);
  }

  setCachedPinnedJobsIfCurrent(
    environment: JenkinsEnvironmentRef,
    values: Set<string>,
    generation: number
  ): void {
    if (generation === this.pinnedUrlsGeneration) {
      this.setCachedPinnedJobs(environment, values);
    }
  }

  // Every watch/pin cache write or invalidation bumps the generation so older in-flight
  // store reads cannot repopulate the cache with stale URLs.
  clearWatchCacheForEnvironment(environmentId?: string): void {
    this.watchedUrlsGeneration += 1;
    this.clearUrlCacheForEnvironment(this.watchedUrlsCache, environmentId);
  }

  clearPinCacheForEnvironment(environmentId?: string): void {
    this.pinnedUrlsGeneration += 1;
    this.clearUrlCacheForEnvironment(this.pinnedUrlsCache, environmentId);
  }

  private clearUrlCacheForEnvironment(
    cache: Map<string, Set<string>>,
    environmentId?: string
  ): void {
    if (!environmentId) {
      cache.clear();
      return;
    }
    const environmentSuffix = `:${environmentId}`;
    for (const key of cache.keys()) {
      if (key.endsWith(environmentSuffix)) {
        cache.delete(key);
      }
    }
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
      this.bumpLoadToken(key);
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
        this.childrenCache.set(key, items);
        this.loadedKeys.add(key);
      })
      .catch((error) => {
        if (!this.isCurrentLoadToken(key, token)) {
          return;
        }
        const items = [this.createErrorPlaceholder("Unable to load data.", error)];
        this.childrenCache.set(key, items);
        this.loadedKeys.add(key);
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

  private bumpLoadToken(key: string): void {
    this.nextLoadToken(key);
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

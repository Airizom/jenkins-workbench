import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { ScopedCache } from "../../services/ScopedCache";
import type { TreeJobScope } from "../TreeJobScope";
import type { PlaceholderTreeItem } from "../items/TreePlaceholderItem";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import {
  buildWorkspaceDirectoryChildrenKey,
  buildWorkspaceDirectoryChildrenPrefix,
  buildWorkspaceDirectorySubtreePrefix,
  buildWorkspaceRootChildrenKey
} from "./TreeChildrenMapping";

export class TreeChildrenCacheManager {
  private readonly watchedUrlsCache = new Map<string, Set<string>>();
  private readonly pinnedUrlsCache = new Map<string, Set<string>>();
  private readonly pendingLoads = new Map<string, Promise<void>>();
  private readonly loadTokens = new Map<string, number>();

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
  }

  deleteChildren(key: string): void {
    this.childrenCache.delete(key);
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
    return this.watchedUrlsCache.get(this.environmentCacheKey(environment));
  }

  setCachedWatchedJobs(environment: JenkinsEnvironmentRef, values: Set<string>): void {
    this.watchedUrlsCache.set(this.environmentCacheKey(environment), values);
  }

  getCachedPinnedJobs(environment: JenkinsEnvironmentRef): Set<string> | undefined {
    return this.pinnedUrlsCache.get(this.environmentCacheKey(environment));
  }

  setCachedPinnedJobs(environment: JenkinsEnvironmentRef, values: Set<string>): void {
    this.pinnedUrlsCache.set(this.environmentCacheKey(environment), values);
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
  }

  clearChildrenCacheForKind(environment: JenkinsEnvironmentRef, kind: string): void {
    const prefix = `${this.childrenCache.buildEnvironmentKey(environment)}:${kind}:`;
    for (const key of this.pendingLoads.keys()) {
      if (key.startsWith(prefix)) {
        this.clearChildrenCache(key);
      }
    }
    this.childrenCache.clearForEnvironmentKind(environment, kind);
  }

  clearWorkspaceChildrenForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): void {
    const buildChildrenKey = (
      kind: string,
      cacheEnvironment: JenkinsEnvironmentRef,
      extra?: string
    ) => this.childrenCache.buildKey(cacheEnvironment, kind, extra);
    this.clearChildrenCache(
      buildWorkspaceRootChildrenKey(buildChildrenKey, environment, jobUrl, jobScope)
    );
    this.clearChildrenCacheByPrefix(
      buildWorkspaceDirectoryChildrenPrefix(buildChildrenKey, environment, jobUrl, jobScope)
    );
  }

  clearWorkspaceDirectorySubtree(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath: string
  ): void {
    const buildChildrenKey = (
      kind: string,
      cacheEnvironment: JenkinsEnvironmentRef,
      extra?: string
    ) => this.childrenCache.buildKey(cacheEnvironment, kind, extra);
    this.clearChildrenCache(
      buildWorkspaceDirectoryChildrenKey(
        buildChildrenKey,
        environment,
        jobUrl,
        jobScope,
        relativePath
      )
    );
    this.clearChildrenCacheByPrefix(
      buildWorkspaceDirectorySubtreePrefix(
        buildChildrenKey,
        environment,
        jobUrl,
        jobScope,
        relativePath
      )
    );
  }

  private clearChildrenCacheByPrefix(prefix: string): void {
    for (const key of Array.from(this.pendingLoads.keys())) {
      if (key.startsWith(prefix)) {
        this.clearChildrenCache(key);
      }
    }
    for (const key of Array.from(this.loadTokens.keys())) {
      if (key.startsWith(prefix) && !this.pendingLoads.has(key)) {
        this.loadTokens.delete(key);
      }
    }
    this.childrenCache.clearByPrefix(prefix);
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
    loader: () => Promise<WorkbenchTreeElement[]>,
    loadingLabel: string
  ): Promise<WorkbenchTreeElement[]> {
    const cached = this.childrenCache.get<WorkbenchTreeElement[]>(key);
    if (cached) {
      return Promise.resolve(cached);
    }

    if (this.pendingLoads.has(key)) {
      return Promise.resolve([this.createLoadingPlaceholder(loadingLabel)]);
    }

    const token = this.nextLoadToken(key);
    const pending = this.withTimeout(
      loader(),
      this.timeoutMs,
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
    return Promise.resolve([this.createLoadingPlaceholder(loadingLabel)]);
  }

  clearForAll(): void {
    this.childrenCache.clear();
    this.pendingLoads.clear();
    this.loadTokens.clear();
    this.artifactCache.clear();
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

  private environmentCacheKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.scope}:${environment.environmentId}`;
  }
}

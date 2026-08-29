import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
  lastAccessedAt: number;
}

interface PendingLoad {
  isValid: boolean;
  promise?: Promise<unknown>;
}

const DEFAULT_MAX_ENTRIES = 1000;

export class JenkinsDataCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly pendingLoads = new Map<string, PendingLoad>();
  private readonly maxEntries: number;

  constructor(
    private readonly defaultTtlMs?: number,
    maxEntries = DEFAULT_MAX_ENTRIES
  ) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  clear(): void {
    this.invalidatePendingLoads();
    this.cache.clear();
  }

  clearForEnvironment(environmentId: string): void {
    const prefix = `${environmentId}:`;
    this.invalidatePendingLoads(prefix);
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.getEntry<T>(key);
    if (entry) {
      entry.lastAccessedAt = Date.now();
    }
    return entry?.value;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.invalidatePendingLoad(key);
    this.setEntry(key, value, ttlMs);
  }

  private setEntry<T>(key: string, value: T, ttlMs?: number): void {
    const resolvedTtl = this.resolveTtlMs(ttlMs);
    if (resolvedTtl === 0) {
      this.cache.delete(key);
      return;
    }
    const now = Date.now();
    const expiresAt = resolvedTtl !== undefined ? now + resolvedTtl : undefined;
    this.cache.set(key, { value, expiresAt, lastAccessedAt: now });
    this.evictIfNeeded();
  }

  delete(key: string): void {
    this.invalidatePendingLoad(key);
    this.cache.delete(key);
  }

  has(key: string): boolean {
    return Boolean(this.getEntry(key));
  }

  getOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const entry = this.getEntry<T>(key);
    if (entry) {
      return Promise.resolve(entry.value);
    }

    const existingLoad = this.pendingLoads.get(key)?.promise;
    if (existingLoad) {
      return existingLoad as Promise<T>;
    }

    const pendingLoad: PendingLoad = { isValid: true };
    const promise = (async () => {
      const result = await loader();
      if (pendingLoad.isValid) {
        this.setEntry(key, result, ttlMs);
      }
      return result;
    })();
    pendingLoad.promise = promise;
    this.pendingLoads.set(key, pendingLoad);
    void promise.then(
      () => this.unregisterPendingLoad(key, pendingLoad),
      () => this.unregisterPendingLoad(key, pendingLoad)
    );
    return promise;
  }

  buildKey(
    environment: JenkinsEnvironmentRef,
    kind: string,
    path?: string,
    authSignature?: string
  ): string {
    const envSignature = `${environment.environmentId}:${environment.url}:${authSignature ?? ""}`;
    return `${envSignature}:${kind}:${path ?? ""}`;
  }

  private getEntry<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  private resolveTtlMs(ttlMs?: number): number | undefined {
    const resolvedTtl = ttlMs ?? this.defaultTtlMs;
    if (resolvedTtl === undefined) {
      return undefined;
    }
    if (!Number.isFinite(resolvedTtl) || resolvedTtl <= 0) {
      return 0;
    }
    return resolvedTtl;
  }

  private unregisterPendingLoad(key: string, pendingLoad: PendingLoad): void {
    if (this.pendingLoads.get(key) === pendingLoad) {
      this.pendingLoads.delete(key);
    }
  }

  private invalidatePendingLoad(key: string): void {
    const pendingLoad = this.pendingLoads.get(key);
    if (!pendingLoad) {
      return;
    }
    pendingLoad.isValid = false;
    this.pendingLoads.delete(key);
  }

  private invalidatePendingLoads(prefix?: string): void {
    for (const [key, pendingLoad] of this.pendingLoads) {
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      pendingLoad.isValid = false;
      this.pendingLoads.delete(key);
    }
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxEntries) {
      return;
    }

    const now = Date.now();
    const entriesToEvict: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        entriesToEvict.push(key);
      }
    }

    for (const key of entriesToEvict) {
      this.cache.delete(key);
    }

    if (this.cache.size <= this.maxEntries) {
      return;
    }

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    const toRemove = this.cache.size - this.maxEntries;
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }
  }
}

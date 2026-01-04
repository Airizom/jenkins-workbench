import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
  lastAccessedAt: number;
}

const DEFAULT_MAX_ENTRIES = 1000;

export class JenkinsDataCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(
    private readonly defaultTtlMs?: number,
    maxEntries = DEFAULT_MAX_ENTRIES
  ) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  clear(): void {
    this.cache.clear();
  }

  clearForEnvironment(environmentId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${environmentId}:`)) {
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
    this.cache.delete(key);
  }

  has(key: string): boolean {
    return Boolean(this.getEntry(key));
  }

  async getOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const entry = this.getEntry<T>(key);
    if (entry) {
      return entry.value;
    }

    try {
      const result = await loader();
      this.set(key, result, ttlMs);
      return result;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  buildKey(environment: JenkinsEnvironmentRef, kind: string, path?: string): string {
    const envSignature = `${environment.environmentId}:${environment.url}:${environment.username ?? ""}`;
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

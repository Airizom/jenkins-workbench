import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { JenkinsDataCache } from "../jenkins/data/JenkinsDataCache";

export class ScopedCache {
  private readonly cache: JenkinsDataCache;
  private readonly keys = new Set<string>();
  private readonly maxEntries: number;
  private readonly pruneThreshold: number;

  constructor(ttlMs: number, maxEntries: number) {
    this.cache = new JenkinsDataCache(ttlMs, maxEntries);
    this.maxEntries = Math.max(1, maxEntries);
    this.pruneThreshold = this.maxEntries * 2;
  }

  buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.environmentId}:${environment.scope}`;
  }

  buildKey(environment: JenkinsEnvironmentRef, kind: string, extra?: string): string {
    return `${this.buildEnvironmentKey(environment)}:${kind}:${extra ?? ""}`;
  }

  get<T>(key: string): T | undefined {
    const value = this.cache.get<T>(key);
    if (value === undefined && !this.cache.has(key)) {
      this.keys.delete(key);
    }
    return value;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
    this.keys.add(key);
    this.pruneIfNeeded();
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.keys.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.keys.clear();
  }

  clearForEnvironment(environmentId: string): void {
    const prefix = `${environmentId}:`;
    for (const key of this.keys) {
      if (!this.cache.has(key)) {
        this.keys.delete(key);
        continue;
      }
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.keys.delete(key);
      }
    }
  }

  clearForEnvironmentKind(environment: JenkinsEnvironmentRef, kind: string): void {
    const prefix = `${this.buildEnvironmentKey(environment)}:${kind}:`;
    for (const key of this.keys) {
      if (!this.cache.has(key)) {
        this.keys.delete(key);
        continue;
      }
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.keys.delete(key);
      }
    }
  }

  private pruneIfNeeded(): void {
    if (this.keys.size <= this.pruneThreshold) {
      return;
    }
    this.pruneStaleKeys();
  }

  private pruneStaleKeys(): void {
    for (const key of this.keys) {
      if (!this.cache.has(key)) {
        this.keys.delete(key);
      }
    }
  }
}

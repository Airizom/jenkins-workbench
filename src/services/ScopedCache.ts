import { JenkinsDataCache } from "../jenkins/data/JenkinsDataCache";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export class ScopedCache {
  private readonly cache: JenkinsDataCache;

  constructor(ttlMs: number, maxEntries: number) {
    this.cache = new JenkinsDataCache(ttlMs, maxEntries);
  }

  buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.environmentId}:${environment.scope}`;
  }

  buildKey(environment: JenkinsEnvironmentRef, kind: string, extra?: string): string {
    return `${this.buildEnvironmentKey(environment)}:${kind}:${extra ?? ""}`;
  }

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  values<T>(): T[] {
    const values: T[] = [];
    for (const key of this.cache.keys()) {
      const value = this.cache.get<T>(key);
      if (value !== undefined) {
        values.push(value);
      }
    }
    return values;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  clearForEnvironment(environmentId: string): void {
    this.cache.clearForEnvironment(environmentId);
  }

  clearForEnvironmentKind(environment: JenkinsEnvironmentRef, kind: string): void {
    this.cache.clearByPrefix(`${this.buildEnvironmentKey(environment)}:${kind}:`);
  }

  clearByPrefix(prefix: string): void {
    this.cache.clearByPrefix(prefix);
  }
}

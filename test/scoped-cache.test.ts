import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { ScopedCache } from "../src/services/ScopedCache";

const env1 = { environmentId: "env-1", scope: "workspace" } as JenkinsEnvironmentRef;
const env2 = { environmentId: "env-2", scope: "workspace" } as JenkinsEnvironmentRef;

describe("ScopedCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only live values after entries expire", () => {
    vi.useFakeTimers();
    const cache = new ScopedCache(1000, 10);
    cache.set(cache.buildKey(env1, "jobs"), "stale");
    vi.advanceTimersByTime(600);
    cache.set(cache.buildKey(env2, "jobs"), "fresh");
    vi.advanceTimersByTime(600);

    assert.deepEqual(cache.values(), ["fresh"]);
  });

  it("clears by environment and by environment kind without touching other entries", () => {
    const cache = new ScopedCache(60_000, 10);
    cache.set(cache.buildKey(env1, "jobs", "a"), "env1-jobs");
    cache.set(cache.buildKey(env1, "artifacts", "a"), "env1-artifacts");
    cache.set(cache.buildKey(env2, "jobs", "a"), "env2-jobs");

    cache.clearForEnvironmentKind(env1, "jobs");
    assert.deepEqual(cache.values().sort(), ["env1-artifacts", "env2-jobs"]);

    cache.clearForEnvironment("env-1");
    assert.deepEqual(cache.values(), ["env2-jobs"]);
  });
});

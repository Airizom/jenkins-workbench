import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsDataCache } from "../src/jenkins/data/JenkinsDataCache";

describe("JenkinsDataCache", () => {
  it.each(["clear", "environment", "delete", "set", "load"])(
    "invalidates all guarded writes on %s without affecting another environment",
    async (invalidation) => {
      const cache = new JenkinsDataCache();
      const key = "env-1:jobs";
      cache.set("env-1:summary", "new summary");
      let release!: () => void;
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      const oldRequest = cache.withWriteGuard([key, "env-1:summary"], async (writer) => {
        await response;
        writer.set(key, "old");
        writer.delete("env-1:summary");
      });
      const otherRequest = cache.withWriteGuard(["env-2:jobs"], async (writer) => {
        await response;
        writer.set("env-2:jobs", "unrelated");
      });
      if (invalidation === "clear") cache.clear();
      if (invalidation === "environment") cache.clearForEnvironment("env-1");
      if (invalidation === "delete") cache.delete(key);
      if (invalidation === "set") cache.set(key, "new");
      if (invalidation === "load") {
        await cache.withWriteGuard([key], async (writer) => writer.set(key, "new"));
      }
      release();
      await Promise.all([oldRequest, otherRequest]);

      assert.equal(cache.get(key), ["set", "load"].includes(invalidation) ? "new" : undefined);
      assert.equal(
        cache.get("env-1:summary"),
        ["clear", "environment"].includes(invalidation) ? undefined : "new summary"
      );
      assert.equal(cache.get("env-2:jobs"), invalidation === "clear" ? undefined : "unrelated");
    }
  );

  it("shares a loader across concurrent misses for the same key", async () => {
    const cache = new JenkinsDataCache();
    let loaderCalls = 0;
    let resolveLoader!: (value: string) => void;
    const loaderResult = new Promise<string>((resolve) => {
      resolveLoader = resolve;
    });
    const loader = (): Promise<string> => {
      loaderCalls += 1;
      return loaderResult;
    };

    const first = cache.getOrLoad("key", loader);
    const second = cache.getOrLoad("key", loader);
    resolveLoader("loaded value");

    assert.equal(loaderCalls, 1);
    assert.deepEqual(await Promise.all([first, second]), ["loaded value", "loaded value"]);
  });

  it("preserves a newer cache value when a pending loader rejects", async () => {
    const cache = new JenkinsDataCache();
    let rejectLoader!: (error: Error) => void;
    const loader = new Promise<string>((_resolve, reject) => {
      rejectLoader = reject;
    });

    const pending = cache.getOrLoad("key", () => loader);
    cache.set("key", "newer value");
    rejectLoader(new Error("load failed"));

    await assert.rejects(pending, /load failed/);
    assert.equal(cache.get<string>("key"), "newer value");
  });

  it.each([
    {
      name: "a full clear",
      mutate: (cache: JenkinsDataCache, _key: string) => cache.clear(),
      expected: undefined
    },
    {
      name: "an environment clear",
      mutate: (cache: JenkinsDataCache, _key: string) => cache.clearForEnvironment("env-1"),
      expected: undefined
    },
    {
      name: "a key deletion",
      mutate: (cache: JenkinsDataCache, key: string) => cache.delete(key),
      expected: undefined
    },
    {
      name: "an explicit replacement",
      mutate: (cache: JenkinsDataCache, key: string) => cache.set(key, "replacement"),
      expected: "replacement"
    }
  ])("does not let a pending load overwrite $name", async ({ mutate, expected }) => {
    const cache = new JenkinsDataCache();
    const key = "env-1:https://jenkins.example/:jobs:";
    let resolveLoader!: (value: string) => void;
    const loader = new Promise<string>((resolve) => {
      resolveLoader = resolve;
    });

    const pending = cache.getOrLoad(key, () => loader);
    mutate(cache, key);
    resolveLoader("stale value");

    assert.equal(await pending, "stale value");
    assert.equal(cache.get<string>(key), expected);
  });
});

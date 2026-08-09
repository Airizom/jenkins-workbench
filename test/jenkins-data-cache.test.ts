import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsDataCache } from "../src/jenkins/data/JenkinsDataCache";

describe("JenkinsDataCache", () => {
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

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { buildScopedEnvironmentKey } from "../src/tree/loader/TreeCacheKeys";
import { deleteTreeEnvironmentKeys } from "../src/tree/TreeEnvironmentKeys";

function environmentRef(
  scope: JenkinsEnvironmentRef["scope"],
  environmentId: string
): JenkinsEnvironmentRef {
  return { scope, environmentId, url: "https://jenkins.example.com/" };
}

describe("buildScopedEnvironmentKey", () => {
  it("builds keys that per-environment clears remove in every scope", () => {
    const cache = new Map<string, number>([
      [buildScopedEnvironmentKey(environmentRef("workspace", "env-1")), 1],
      [buildScopedEnvironmentKey(environmentRef("global", "env-1")), 2],
      [buildScopedEnvironmentKey(environmentRef("global", "env-2")), 3],
      [buildScopedEnvironmentKey(environmentRef("global", "nv-1")), 4]
    ]);

    deleteTreeEnvironmentKeys(cache, "env-1");

    assert.deepEqual([...cache.values()], [3, 4]);
  });
});

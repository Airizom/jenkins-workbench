import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { ActivityDisplaySummary } from "../src/tree/ActivityTypes";
import { TreeActivityCache } from "../src/tree/loader/TreeActivityCache";
import type { TreeChildrenCacheManager } from "../src/tree/loader/TreeChildrenCacheManager";

class FakeTreeChildrenCacheManager {
  readonly children = new Map<string, unknown>();

  getCachedChildren<T>(key: string): T | undefined {
    return this.children.get(key) as T | undefined;
  }

  setChildren<T>(key: string, items: T[]): void {
    this.children.set(key, items);
  }

  clearChildrenCache(key: string): void {
    this.children.delete(key);
  }
}

const summary: ActivityDisplaySummary = {
  displayedTotal: 1,
  limit: 10,
  isTruncated: false,
  groups: [{ kind: "running", displayedCount: 1, isTruncated: false }]
};

describe("TreeActivityCache", () => {
  it("clears scoped activity child caches from legacy environment-id invalidation", () => {
    const cacheManager = new FakeTreeChildrenCacheManager();
    const activityCache = new TreeActivityCache(
      cacheManager as unknown as TreeChildrenCacheManager,
      (kind, environment, extra) =>
        `${environment.scope}:${environment.environmentId}:${kind}:${extra ?? ""}`
    );
    const environment: JenkinsEnvironmentRef = {
      scope: "workspace",
      environmentId: "jenkins-main",
      url: "https://jenkins.example.com"
    };

    activityCache.setSummary(environment, summary);
    const rootKey = activityCache.buildActivityRootChildrenKey(environment);
    cacheManager.setChildren(rootKey, [{ id: "root-child" }]);
    activityCache.setGroupChildren(environment, "running", [{ id: "group-child" }]);
    const groupKey = activityCache.buildActivityGroupChildrenKey(environment, "running");

    activityCache.clearForEnvironmentIdAcrossScopes(environment.environmentId);

    assert.equal(activityCache.getSummary(environment), undefined);
    assert.equal(cacheManager.getCachedChildren(rootKey), undefined);
    assert.equal(cacheManager.getCachedChildren(groupKey), undefined);
  });
});

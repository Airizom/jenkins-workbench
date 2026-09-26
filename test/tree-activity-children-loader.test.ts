import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { ActivityCollector } from "../src/tree/activity/ActivityCollector";
import { ActivityGroupTreeItem } from "../src/tree/items/TreeRootItems";
import type { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";
import { TreeActivityChildrenLoader } from "../src/tree/loader/TreeActivityChildrenLoader";
import type { TreeChildrenCacheManager } from "../src/tree/loader/TreeChildrenCacheManager";
import type { TreeJobUrlStateLoader } from "../src/tree/loader/TreeJobUrlStateLoader";
import type { TreePlaceholderFactory } from "../src/tree/loader/TreePlaceholderFactory";

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

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "jenkins-main",
  url: "https://jenkins.example.com"
};

const placeholders: TreePlaceholderFactory = {
  createEmptyPlaceholder: (label, description) =>
    ({ kind: "empty", label, description }) as unknown as PlaceholderTreeItem,
  createErrorPlaceholder: (label, error) =>
    ({ kind: "error", label, error }) as unknown as PlaceholderTreeItem
};

describe("TreeActivityChildrenLoader", () => {
  it("returns an error placeholder when an uncached group load fails to collect activity", async () => {
    const failure = new Error("Jenkins unavailable");
    const collector = {
      collect: async () => {
        throw failure;
      }
    } as unknown as ActivityCollector;
    const loader = new TreeActivityChildrenLoader(
      collector,
      new FakeTreeChildrenCacheManager() as unknown as TreeChildrenCacheManager,
      {} as TreeJobUrlStateLoader,
      (kind, env, extra) => `${env.scope}:${env.environmentId}:${kind}:${extra ?? ""}`,
      {} as never,
      () => ({}) as never,
      placeholders,
      () => undefined
    );

    const children = await loader.loadActivityGroup(
      new ActivityGroupTreeItem(environment, "running", 1)
    );

    assert.deepEqual(children, [
      { kind: "error", label: "Unable to load activity.", error: failure }
    ]);
  });
});

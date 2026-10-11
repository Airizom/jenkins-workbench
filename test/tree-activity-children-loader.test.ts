import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { ScopedCache } from "../src/services/ScopedCache";
import type { ActivityViewModel } from "../src/tree/ActivityTypes";
import type { ActivityCollector } from "../src/tree/activity/ActivityCollector";
import { ActivityFolderTreeItem, ActivityGroupTreeItem } from "../src/tree/items/TreeRootItems";
import type { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";
import { TreeActivityChildrenLoader } from "../src/tree/loader/TreeActivityChildrenLoader";
import { TreeChildrenCacheManager } from "../src/tree/loader/TreeChildrenCacheManager";
import {
  createTreeElementChildrenHandlers,
  type TreeElementChildrenHandlerDependencies
} from "../src/tree/loader/TreeElementChildrenHandlers";
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
  it.each(["root", "sibling"])(
    "preserves a refreshed group's children when an older %s load finishes",
    async (source) => {
      const childrenCache = new ScopedCache(60_000, 100);
      const cacheManager = new TreeChildrenCacheManager(
        childrenCache,
        new ScopedCache(60_000, 100),
        () => undefined,
        0,
        (label) => placeholders.createEmptyPlaceholder(label),
        placeholders.createErrorPlaceholder
      );
      const viewModel = (name: string): ActivityViewModel => ({
        summary: {
          displayedTotal: 1,
          limit: 10,
          isTruncated: false,
          groups: [{ kind: "running", displayedCount: 1, isTruncated: false }]
        },
        groups: [
          {
            kind: "running",
            displayedCount: 1,
            isTruncated: false,
            items: [{ group: "running", name, url: `${environment.url}/job/${name}/`, kind: "job" }]
          }
        ]
      });
      let resolveOlder: (value: ActivityViewModel) => void = () => undefined;
      const olderResponse = new Promise<ActivityViewModel>((resolve) => {
        resolveOlder = resolve;
      });
      let resolveNewer: (value: ActivityViewModel) => void = () => undefined;
      const newerResponse = new Promise<ActivityViewModel>((resolve) => {
        resolveNewer = resolve;
      });
      const collect = vi
        .fn()
        .mockResolvedValueOnce(viewModel("initial"))
        .mockReturnValueOnce(olderResponse)
        .mockReturnValueOnce(newerResponse);
      const loader = new TreeActivityChildrenLoader(
        { collect } as unknown as ActivityCollector,
        cacheManager,
        {
          getWatchedJobUrls: async () => new Set<string>(),
          getPinnedJobUrls: async () => new Set<string>()
        } as unknown as TreeJobUrlStateLoader,
        (kind, env, extra) => childrenCache.buildKey(env, kind, extra),
        {} as never,
        () => ({}) as never,
        placeholders,
        () => undefined
      );
      const folder = new ActivityFolderTreeItem(environment);
      await loader.loadActivityGroups(folder);
      const group = new ActivityGroupTreeItem(environment, "running", 1);
      const olderElement =
        source === "root" ? folder : new ActivityGroupTreeItem(environment, "unstable", 1);
      const olderKey =
        source === "root"
          ? loader.buildActivityRootChildrenKey(environment)
          : loader.buildActivityGroupChildrenKey(environment, "unstable");
      // Mark the older source as previously expanded so its request awaits completion.
      cacheManager.setChildren(olderKey, []);
      cacheManager.clearChildrenCache(olderKey);
      const handlers = createTreeElementChildrenHandlers({
        cacheManager,
        activityLoader: loader
      } as TreeElementChildrenHandlerDependencies);
      const olderHandler = handlers.find((handler) => handler.matches(olderElement));
      const groupHandler = handlers.find((handler) => handler.matches(group));
      assert.ok(olderHandler?.getChildren);
      assert.ok(groupHandler?.getChildren);
      assert.ok(groupHandler.invalidate);
      const olderLoad = olderHandler.getChildren(olderElement);
      assert.equal(collect.mock.calls.length, 2);

      groupHandler.invalidate(group);
      const newerLoad = groupHandler.getChildren(group);
      assert.equal(collect.mock.calls.length, 3);
      resolveNewer(viewModel("newer"));
      const newerChildren = await newerLoad;
      assert.equal(newerChildren[0].label, "newer");

      resolveOlder(viewModel("older"));
      await olderLoad;
      assert.deepEqual(await groupHandler.getChildren(group), newerChildren);
    }
  );

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

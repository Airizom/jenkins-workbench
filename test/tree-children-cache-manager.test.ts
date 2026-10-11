import { expect, it, vi } from "vitest";
import { ScopedCache } from "../src/services/ScopedCache";
import { TreeChildrenCacheManager } from "../src/tree/loader/TreeChildrenCacheManager";
import { LOADED_CHILDREN_KEYS_MAX_ENTRIES } from "../src/tree/loader/TreeChildrenConfig";
import { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";

function setup(childrenCacheEntries = 100) {
  const placeholder = vi.fn(() => new PlaceholderTreeItem("Loading"));
  const manager = new TreeChildrenCacheManager(
    new ScopedCache(60000, childrenCacheEntries),
    new ScopedCache(60000, 100),
    () => {},
    0,
    placeholder,
    () => new PlaceholderTreeItem("Error")
  );
  return { manager, placeholder };
}
it("awaits refreshed children instead of temporarily removing rendered tree IDs", async () => {
  const { manager, placeholder } = setup();
  const old = new PlaceholderTreeItem("old");
  const next = new PlaceholderTreeItem("next");
  manager.setChildren("key", [old]);
  manager.clearChildrenCacheForEnvironment();
  let finish = (_items: PlaceholderTreeItem[]) => {};
  const loader = vi.fn(
    () =>
      new Promise<PlaceholderTreeItem[]>((resolve) => {
        finish = resolve;
      })
  );
  const first = manager.getOrLoadChildren("key", undefined, loader, "Loading");
  const second = manager.getOrLoadChildren("key", undefined, loader, "Loading");
  expect(placeholder).not.toHaveBeenCalled();
  expect(loader).toHaveBeenCalledTimes(1);
  finish([next]);
  expect(await first).toEqual([next]);
  expect(await second).toEqual([next]);
});
it("never reuses a stale load token after clearing all caches", async () => {
  const { manager } = setup();
  let finish = (_items: PlaceholderTreeItem[]) => {};
  const old = new PlaceholderTreeItem("old");
  const next = new PlaceholderTreeItem("next");
  await manager.getOrLoadChildren(
    "key",
    undefined,
    () =>
      new Promise<PlaceholderTreeItem[]>((resolve) => {
        finish = resolve;
      }),
    "Loading"
  );
  manager.clearChildrenCacheForEnvironment();
  let finishNext = (_items: PlaceholderTreeItem[]) => {};
  await manager.getOrLoadChildren(
    "key",
    undefined,
    () =>
      new Promise<PlaceholderTreeItem[]>((resolve) => {
        finishNext = resolve;
      }),
    "Loading"
  );
  finish([old]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(manager.getCachedChildren("key")).toBeUndefined();
  finishNext([next]);
  await vi.waitFor(() => expect(manager.getCachedChildren("key")).toEqual([next]));
});

it("bounds load history and keeps recently accessed keys", async () => {
  const { manager } = setup(LOADED_CHILDREN_KEYS_MAX_ENTRIES + 1);
  const loadedKeys = Reflect.get(manager, "loadedKeys") as Set<string>;
  for (let index = 0; index < LOADED_CHILDREN_KEYS_MAX_ENTRIES; index++) {
    manager.setChildren(`key:${index}`, []);
  }
  // A cache hit refreshes the key's place in the history.
  await manager.getOrLoadChildren("key:0", undefined, async () => [], "Loading");
  manager.setChildren("key:extra", []);

  expect(loadedKeys.size).toBe(LOADED_CHILDREN_KEYS_MAX_ENTRIES);
  expect(loadedKeys.has("key:0")).toBe(true);
  expect(loadedKeys.has("key:1")).toBe(false);
  expect(loadedKeys.has("key:extra")).toBe(true);
});

it.each(["success", "failure"])(
  "bounds load history for asynchronous %s loads",
  async (outcome) => {
    const { manager } = setup();
    const loadedKeys = Reflect.get(manager, "loadedKeys") as Set<string>;
    for (let index = 0; index <= LOADED_CHILDREN_KEYS_MAX_ENTRIES; index++) {
      await manager.getOrLoadChildren(
        `key:${index}`,
        undefined,
        async () => {
          if (outcome === "failure") {
            throw new Error("failed");
          }
          return [];
        },
        "Loading"
      );
    }
    await vi.waitFor(() =>
      expect(loadedKeys.has(`key:${LOADED_CHILDREN_KEYS_MAX_ENTRIES}`)).toBe(true)
    );
    expect(loadedKeys.size).toBe(LOADED_CHILDREN_KEYS_MAX_ENTRIES);
    expect(loadedKeys.has("key:0")).toBe(false);
  }
);

it("keeps load history when an environment refresh clears its children", async () => {
  const { manager, placeholder } = setup();
  const key = "env-1:workspace:builds:job";
  manager.setChildren(key, [new PlaceholderTreeItem("old")]);
  manager.clearChildrenCacheForEnvironment("env-1");
  const next = new PlaceholderTreeItem("next");

  expect(await manager.getOrLoadChildren(key, undefined, async () => [next], "Loading")).toEqual([
    next
  ]);
  expect(placeholder).not.toHaveBeenCalled();
});

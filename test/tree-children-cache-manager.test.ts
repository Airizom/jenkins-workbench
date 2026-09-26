import { expect, it, vi } from "vitest";
import { ScopedCache } from "../src/services/ScopedCache";
import { TreeChildrenCacheManager } from "../src/tree/loader/TreeChildrenCacheManager";
import { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";

function setup() {
  const placeholder = vi.fn(() => new PlaceholderTreeItem("Loading"));
  const manager = new TreeChildrenCacheManager(
    new ScopedCache(60000, 100),
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

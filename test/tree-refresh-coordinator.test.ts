import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { TreeDataProviderRefreshCoordinator } from "../src/tree/TreeDataProviderRefreshCoordinator";
import type { WorkbenchTreeElement } from "../src/tree/items/WorkbenchTreeElement";

const DEBOUNCE_MS = 5;

function createCoordinator(): {
  coordinator: TreeDataProviderRefreshCoordinator;
  notified: Array<WorkbenchTreeElement | undefined>;
} {
  const notified: Array<WorkbenchTreeElement | undefined> = [];
  const coordinator = new TreeDataProviderRefreshCoordinator(
    (element) => {
      notified.push(element);
      for (const token of coordinator.takePendingRefreshWaiters()) {
        coordinator.resolveRefreshWaiter(token);
      }
    },
    () => undefined
  );

  return { coordinator, notified };
}

function waitForDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 20));
}

describe("TreeDataProviderRefreshCoordinator", () => {
  it("debounces repeated scheduled refreshes into one full-tree notification", async () => {
    const { coordinator, notified } = createCoordinator();

    coordinator.scheduleRefresh(undefined, DEBOUNCE_MS);
    coordinator.scheduleRefresh(undefined, DEBOUNCE_MS);
    coordinator.scheduleRefresh(undefined, DEBOUNCE_MS);
    await waitForDebounce();

    assert.deepEqual(notified, [undefined]);
    coordinator.dispose();
  });

  it("resolves every refresh token registered before the debounced notification", async () => {
    const { coordinator, notified } = createCoordinator();
    const first = coordinator.createRefreshWaiter();
    const second = coordinator.createRefreshWaiter();

    coordinator.scheduleRefresh(first.token, DEBOUNCE_MS);
    coordinator.scheduleRefresh(second.token, DEBOUNCE_MS);
    await Promise.all([first.promise, second.promise]);

    assert.deepEqual(notified, [undefined]);
    coordinator.dispose();
  });

  it("fires a separate full-tree notification for refreshes scheduled after the debounce", async () => {
    const { coordinator, notified } = createCoordinator();

    coordinator.scheduleRefresh(undefined, DEBOUNCE_MS);
    await waitForDebounce();
    coordinator.scheduleRefresh(undefined, DEBOUNCE_MS);
    await waitForDebounce();

    assert.deepEqual(notified, [undefined, undefined]);
    coordinator.dispose();
  });
});

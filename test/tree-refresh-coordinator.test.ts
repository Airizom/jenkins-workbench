import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreeDataProviderRefreshCoordinator } from "../src/tree/TreeDataProviderRefreshCoordinator";
import type { WorkbenchTreeElement } from "../src/tree/items/WorkbenchTreeElement";

const DEBOUNCE_MS = 5;

function createElement(): WorkbenchTreeElement {
  return {} as unknown as WorkbenchTreeElement;
}

function createCoordinator(): {
  coordinator: TreeDataProviderRefreshCoordinator;
  notified: Array<WorkbenchTreeElement | undefined>;
  invalidated: WorkbenchTreeElement[];
  schedule: (element?: WorkbenchTreeElement) => void;
} {
  const notified: Array<WorkbenchTreeElement | undefined> = [];
  const invalidated: WorkbenchTreeElement[] = [];
  const coordinator = new TreeDataProviderRefreshCoordinator(
    (element) => notified.push(element),
    () => undefined
  );

  return {
    coordinator,
    notified,
    invalidated,
    schedule: (element) => {
      coordinator.scheduleRefresh(element, undefined, DEBOUNCE_MS, (invalidatedElement) => {
        invalidated.push(invalidatedElement);
      });
    }
  };
}

function waitForDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 20));
}

describe("TreeDataProviderRefreshCoordinator", () => {
  it("fires an element-scoped refresh for a single pending element", async () => {
    const { coordinator, notified, invalidated, schedule } = createCoordinator();
    const element = createElement();

    schedule(element);
    await waitForDebounce();

    assert.deepEqual(notified, [element]);
    assert.deepEqual(invalidated, [element]);
    coordinator.dispose();
  });

  it("coalesces repeated refreshes of the same element into one element-scoped refresh", async () => {
    const { coordinator, notified, schedule } = createCoordinator();
    const element = createElement();

    schedule(element);
    schedule(element);
    await waitForDebounce();

    assert.deepEqual(notified, [element]);
    coordinator.dispose();
  });

  it("escalates distinct pending elements to a full refresh", async () => {
    const { coordinator, notified, schedule } = createCoordinator();

    schedule(createElement());
    schedule(createElement());
    await waitForDebounce();

    assert.deepEqual(notified, [undefined]);
    coordinator.dispose();
  });

  it("keeps a pending full refresh full when an element-scoped refresh arrives", async () => {
    const { coordinator, notified, schedule } = createCoordinator();

    schedule(undefined);
    schedule(createElement());
    await waitForDebounce();

    assert.deepEqual(notified, [undefined]);
    coordinator.dispose();
  });

  it("escalates a pending element-scoped refresh when a full refresh arrives", async () => {
    const { coordinator, notified, schedule } = createCoordinator();

    schedule(createElement());
    schedule(undefined);
    await waitForDebounce();

    assert.deepEqual(notified, [undefined]);
    coordinator.dispose();
  });

  it("resets pending state after firing so later element refreshes stay element-scoped", async () => {
    const { coordinator, notified, schedule } = createCoordinator();
    const first = createElement();
    const second = createElement();

    schedule(first);
    await waitForDebounce();
    schedule(second);
    await waitForDebounce();

    assert.deepEqual(notified, [first, second]);
    coordinator.dispose();
  });
});

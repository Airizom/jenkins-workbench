import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { retryOnTreeChange } from "../src/tree/TreeChangeRetry";
import type { WorkbenchTreeElement } from "../src/tree/items/WorkbenchTreeElement";

type Disposable = { dispose(): void };
type TreeChangeListener = (element: WorkbenchTreeElement | undefined) => void;

class TestTreeChanges {
  private readonly listeners = new Set<TreeChangeListener>();

  readonly event = (listener: TreeChangeListener): Disposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  fire(element?: WorkbenchTreeElement): void {
    for (const listener of this.listeners) {
      listener(element);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

type AttemptResult = {
  pending: boolean;
  pendingElement?: WorkbenchTreeElement;
  value?: string;
};

function createElement(id: string): WorkbenchTreeElement {
  return { id } as WorkbenchTreeElement;
}

function createOptions(changes: TestTreeChanges, operation: () => Promise<AttemptResult>) {
  return {
    operation,
    onDidChangeTreeData: changes.event,
    shouldRetry: (result: AttemptResult) => result.pending,
    getPendingElement: (result: AttemptResult) => result.pendingElement,
    timeoutMs: 50
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("retryOnTreeChange", () => {
  it("observes an equivalent-element event emitted during the operation", async () => {
    const changes = new TestTreeChanges();
    const pendingElement = createElement("jobs");
    let operationCount = 0;

    const result = await retryOnTreeChange(
      createOptions(changes, async () => {
        operationCount += 1;
        if (operationCount === 1) {
          changes.fire(createElement("jobs"));
          return { pending: true, pendingElement };
        }
        return { pending: false, value: "loaded" };
      })
    );

    assert.equal(result.value, "loaded");
    assert.equal(operationCount, 2);
    assert.equal(changes.listenerCount, 0);
  });

  it("retries for a global event but ignores an unrelated targeted event", async () => {
    const changes = new TestTreeChanges();
    const pendingElement = createElement("jobs");
    let operationCount = 0;
    const resolution = retryOnTreeChange(
      createOptions(changes, async () => {
        operationCount += 1;
        return operationCount === 1
          ? { pending: true, pendingElement }
          : { pending: false, value: "loaded" };
      })
    );
    await Promise.resolve();

    changes.fire(createElement("nodes"));
    await Promise.resolve();
    assert.equal(operationCount, 1);

    changes.fire(undefined);
    assert.equal((await resolution).value, "loaded");
    assert.equal(operationCount, 2);
    assert.equal(changes.listenerCount, 0);
  });

  it("returns after a timeout when timeout retries are disabled", async () => {
    vi.useFakeTimers();
    const changes = new TestTreeChanges();
    let operationCount = 0;
    const resolution = retryOnTreeChange(
      createOptions(changes, async () => {
        operationCount += 1;
        return { pending: true, pendingElement: createElement("jobs") };
      })
    );

    await vi.advanceTimersByTimeAsync(50);

    assert.equal((await resolution).pending, true);
    assert.equal(operationCount, 1);
    assert.equal(changes.listenerCount, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("can start the timeout before the operation completes", async () => {
    vi.useFakeTimers();
    const changes = new TestTreeChanges();
    const pendingElement = createElement("jobs");
    let operationCount = 0;
    let resolveFirst: ((result: AttemptResult) => void) | undefined;
    const resolution = retryOnTreeChange({
      ...createOptions(changes, async () => {
        operationCount += 1;
        if (operationCount === 1) {
          return await new Promise<AttemptResult>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return { pending: false, value: "loaded" };
      }),
      getPendingElementBeforeOperation: () => pendingElement,
      retryAfterTimeout: true
    });

    await vi.advanceTimersByTimeAsync(50);
    assert.equal(changes.listenerCount, 0);
    assert.equal(vi.getTimerCount(), 0);
    resolveFirst?.({ pending: true, pendingElement });

    assert.equal((await resolution).value, "loaded");
    assert.equal(operationCount, 2);
    assert.equal(changes.listenerCount, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("retries when the resolved pending element changed during an early wait", async () => {
    vi.useFakeTimers();
    const changes = new TestTreeChanges();
    let operationCount = 0;
    const resolution = retryOnTreeChange({
      ...createOptions(changes, async () => {
        operationCount += 1;
        if (operationCount === 1) {
          changes.fire(createElement("nodes"));
          return { pending: true, pendingElement: createElement("nodes") };
        }
        return { pending: false, value: "loaded" };
      }),
      getPendingElementBeforeOperation: () => createElement("jobs")
    });

    await vi.advanceTimersByTimeAsync(0);

    assert.equal((await resolution).value, "loaded");
    assert.equal(operationCount, 2);
    assert.equal(changes.listenerCount, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("exhausts the retry limit and cleans up each subscription and timer", async () => {
    vi.useFakeTimers();
    const changes = new TestTreeChanges();
    let operationCount = 0;
    const resolution = retryOnTreeChange({
      ...createOptions(changes, async () => {
        operationCount += 1;
        return { pending: true, pendingElement: createElement("jobs") };
      }),
      retryAfterTimeout: true,
      retryLimit: 2
    });

    await vi.advanceTimersByTimeAsync(100);

    assert.equal((await resolution).pending, true);
    assert.equal(operationCount, 3);
    assert.equal(changes.listenerCount, 0);
    assert.equal(vi.getTimerCount(), 0);
  });
});

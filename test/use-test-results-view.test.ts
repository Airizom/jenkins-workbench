import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { BuildTestResultsViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";

// Keep state and refs across renders, and flush dependency-gated effects until
// state settles, following the existing DOM-free hook test pattern.
const slots: unknown[] = [];
let cursor = 0;
let dirty = false;
let pendingEffects: Array<() => void> = [];

vi.doMock("react", () => ({
  useState<T>(initial: T | (() => T)) {
    const index = cursor++;
    if (!(index in slots)) {
      slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    }
    return [
      slots[index] as T,
      (next: T | ((previous: T) => T)) => {
        const previous = slots[index] as T;
        slots[index] = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
        dirty ||= !Object.is(previous, slots[index]);
      }
    ] as const;
  },
  useRef<T>(initial: T) {
    const index = cursor++;
    if (!(index in slots)) {
      slots[index] = { current: initial };
    }
    return slots[index] as { current: T };
  },
  useEffect(effect: () => void, deps: readonly unknown[]) {
    const index = cursor++;
    const previous = slots[index] as readonly unknown[] | undefined;
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
      slots[index] = deps;
      pendingEffects.push(effect);
    }
  },
  useMemo: <T>(factory: () => T): T => factory(),
  useCallback: <T>(callback: T): T => callback
}));

const { useTestResultsView: runTestResultsView } = await import(
  "../src/panels/buildDetails/webview/components/buildDetails/testResults/useTestResultsView"
);

const results: BuildTestResultsViewModel = { items: [], loading: false };

function render(buildUrl: string, failedCount: number) {
  let view: ReturnType<typeof runTestResultsView>;
  do {
    dirty = false;
    cursor = 0;
    view = runTestResultsView({ buildUrl, failedCount, results });
    const effects = pendingEffects;
    pendingEffects = [];
    for (const effect of effects) {
      effect();
    }
  } while (dirty);
  return view;
}

beforeEach(() => {
  slots.length = 0;
  pendingEffects = [];
  cursor = 0;
  dirty = false;
});

describe("useTestResultsView", () => {
  it("defaults to failures when consecutive builds have the same failure count", () => {
    assert.equal(render("build-a", 2).statusFilter, "failed");
    assert.equal(render("build-b", 2).statusFilter, "failed");
  });

  it("preserves a user-selected filter during updates within the same build", () => {
    render("build-a", 2).setStatusFilter("passed");
    assert.equal(render("build-a", 2).statusFilter, "passed");
    assert.equal(render("build-a", 3).statusFilter, "passed");
    assert.equal(render("build-b", 3).statusFilter, "failed");
  });

  it("applies the failure default when counts arrive asynchronously for a new build", () => {
    assert.equal(render("build-a", 2).statusFilter, "failed");
    assert.equal(render("build-b", 0).statusFilter, "all");
    assert.equal(render("build-b", 2).statusFilter, "failed");
  });
});

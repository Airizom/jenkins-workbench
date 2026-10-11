import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { BuildComparePanelSerializedState } from "../src/panels/buildCompare/shared/BuildComparePanelWebviewState";
import type { BuildCompareOutgoingMessage } from "../src/panels/buildCompare/shared/BuildComparePanelMessages";
import type { BuildCompareAction } from "../src/panels/buildCompare/webview/state/buildCompareState";

type Deps = readonly unknown[] | undefined;

/**
 * Minimal single-component hook runtime: enough of React's hook semantics
 * (slot order, functional updates, dependency-gated effects) to drive a hook
 * without a DOM.
 */
function createHookHarness() {
  const slots: unknown[] = [];
  let index = 0;
  let pendingEffects: Array<() => void> = [];
  let dirty = false;

  const depsChanged = (previous: Deps, next: Deps) =>
    !previous ||
    !next ||
    previous.length !== next.length ||
    previous.some((value, i) => !Object.is(value, next[i]));

  const react = {
    useState<T>(initial: T | (() => T)) {
      const i = index++;
      if (!(i in slots)) {
        slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((current: T) => T)) => {
        const previous = slots[i] as T;
        slots[i] = typeof next === "function" ? (next as (current: T) => T)(previous) : next;
        if (!Object.is(previous, slots[i])) {
          dirty = true;
        }
      };
      return [slots[i] as T, setState] as const;
    },
    useRef<T>(initial: T) {
      const i = index++;
      if (!(i in slots)) {
        slots[i] = { current: initial };
      }
      return slots[i] as { current: T };
    },
    useCallback<T>(fn: T, deps: Deps) {
      const i = index++;
      const previous = slots[i] as { fn: T; deps: Deps } | undefined;
      if (!previous || depsChanged(previous.deps, deps)) {
        slots[i] = { fn, deps };
      }
      return (slots[i] as { fn: T }).fn;
    },
    useEffect(effect: () => void, deps: Deps) {
      const i = index++;
      const previous = slots[i] as Deps | null | undefined;
      if (previous === undefined || depsChanged(previous ?? undefined, deps)) {
        slots[i] = deps ?? null;
        pendingEffects.push(effect);
      }
    }
  };

  function render<T>(hook: () => T): { result: () => T; rerender: () => void } {
    let result!: T;
    const run = () => {
      do {
        dirty = false;
        index = 0;
        result = hook();
        const effects = pendingEffects;
        pendingEffects = [];
        for (const effect of effects) {
          effect();
        }
      } while (dirty);
    };
    run();
    return { result: () => result, rerender: run };
  }

  return { react, render };
}

describe("useCollapsedSections", () => {
  let savedState: unknown;
  let setStateCalls: number;

  async function loadHook() {
    const harness = createHookHarness();
    vi.doMock("react", () => harness.react);
    const { useCollapsedSections } = await import(
      "../src/panels/buildCompare/webview/hooks/useCollapsedSections"
    );
    return harness.render(() => useCollapsedSections());
  }

  beforeEach(() => {
    vi.resetModules();
    savedState = undefined;
    setStateCalls = 0;
    vi.stubGlobal("window", {
      acquireVsCodeApi: () => ({
        postMessage: () => undefined,
        getState: () => savedState,
        setState: (state: unknown) => {
          setStateCalls += 1;
          savedState = state;
          return state;
        }
      })
    });
  });

  afterEach(() => {
    vi.doUnmock("react");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the section default without overrides", async () => {
    const hook = await loadHook();

    assert.equal(hook.result().isOpen("tests"), true);
    assert.equal(hook.result().isOpen("tests", false), false);
    assert.equal(setStateCalls, 0);
  });

  it("lets saved overrides take precedence over the default", async () => {
    savedState = {
      baselineBuildUrl: "https://jenkins.example/job/demo/1/",
      compareUi: { collapsedSections: ["tests"], expandedSections: ["stages"] }
    };

    const hook = await loadHook();

    assert.equal(hook.result().isOpen("tests", true), false);
    assert.equal(hook.result().isOpen("stages", false), true);
    assert.equal(hook.result().isOpen("console", false), false);
    assert.equal(setStateCalls, 0, "initial state read from storage is not rewritten");
  });

  it("persists toggles while keeping the rest of the saved state", async () => {
    savedState = {
      baselineBuildUrl: "https://jenkins.example/job/demo/1/",
      compareUi: { collapsedSections: ["tests"], expandedSections: ["stages"] }
    };
    const hook = await loadHook();

    hook.result().setOpen("tests", true);
    hook.rerender();

    assert.equal(hook.result().isOpen("tests", false), true);
    assert.deepEqual(savedState, {
      baselineBuildUrl: "https://jenkins.example/job/demo/1/",
      compareUi: { collapsedSections: [], expandedSections: ["stages", "tests"] }
    });

    hook.result().setOpen("stages", false);
    hook.rerender();

    assert.equal(hook.result().isOpen("stages", true), false);
    assert.deepEqual(savedState, {
      baselineBuildUrl: "https://jenkins.example/job/demo/1/",
      compareUi: { collapsedSections: ["stages"], expandedSections: ["tests"] }
    });
  });

  it("restores persisted toggles in a fresh webview", async () => {
    const first = await loadHook();
    first.result().setOpen("console", false);
    first.result().setOpen("parameters", true);
    first.rerender();

    vi.resetModules();
    const second = await loadHook();

    assert.equal(second.result().isOpen("console", true), false);
    assert.equal(second.result().isOpen("parameters", false), true);
  });
});

describe("useBuildCompareMessages", () => {
  const calls: string[] = [];
  let adoptedStates: BuildComparePanelSerializedState[];
  type Reducer = (
    message: BuildCompareOutgoingMessage,
    dispatch: (action: BuildCompareAction) => void
  ) => void;
  let reducer: Reducer | undefined;

  beforeEach(() => {
    vi.resetModules();
    calls.length = 0;
    adoptedStates = [];
    reducer = undefined;
    vi.doMock("../src/panels/shared/webview/hooks/usePanelMessages", () => ({
      usePanelMessages: (_parse: unknown, _dispatch: unknown, reduce: Reducer) => {
        reducer = reduce;
      }
    }));
    vi.doMock("../src/panels/buildCompare/webview/lib/buildComparePanelState", () => ({
      adoptHostPanelState: (state: BuildComparePanelSerializedState) => {
        calls.push("adoptHostPanelState");
        adoptedStates.push(state);
      }
    }));
  });

  afterEach(() => {
    vi.doUnmock("../src/panels/shared/webview/hooks/usePanelMessages");
    vi.doUnmock("../src/panels/buildCompare/webview/lib/buildComparePanelState");
    vi.resetModules();
  });

  async function reduce(message: unknown): Promise<BuildCompareAction[]> {
    const { useBuildCompareMessages } = await import(
      "../src/panels/buildCompare/webview/hooks/useBuildCompareMessages"
    );
    const actions: BuildCompareAction[] = [];
    const dispatch = (action: BuildCompareAction) => {
      calls.push(`dispatch:${action.type}`);
      actions.push(action);
    };
    function MessagesProbe(): null {
      useBuildCompareMessages(dispatch);
      return null;
    }
    renderToStaticMarkup(createElement(MessagesProbe));
    assert.ok(reducer, "reducer registered with usePanelMessages");
    reducer(message as BuildCompareOutgoingMessage, dispatch);
    return actions;
  }

  it("adopts the host panel state before replacing the comparison", async () => {
    const panelState = {
      baselineBuildUrl: "b",
      targetBuildUrl: "t"
    } as BuildComparePanelSerializedState;
    const model = { title: "Compare" };

    const actions = await reduce({ type: "updateBuildCompare", panelState, model });

    assert.deepEqual(calls, ["adoptHostPanelState", "dispatch:replaceComparison"]);
    assert.deepEqual(adoptedStates, [panelState]);
    assert.deepEqual(actions, [{ type: "replaceComparison", model }]);
  });

  it("dispatches console section updates", async () => {
    const consoleSection = { status: "identical" };

    const actions = await reduce({ type: "updateConsoleSection", console: consoleSection });

    assert.deepEqual(actions, [{ type: "updateConsoleSection", console: consoleSection }]);
    assert.deepEqual(adoptedStates, []);
  });

  it("dispatches refresh failures as action failures", async () => {
    const actions = await reduce({ type: "buildCompareRefreshFailed", message: "boom" });

    assert.deepEqual(actions, [{ type: "actionFailed", message: "boom" }]);
    assert.deepEqual(adoptedStates, []);
  });
});

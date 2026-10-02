import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

// Minimal hook runtime: state and refs persist by call order, effects run after
// each render when their dependencies change.
const slots: unknown[] = [];
const effects: Array<{ deps?: readonly unknown[]; cleanup?: () => void }> = [];
let pendingEffects: Array<() => void> = [];
let slotCursor = 0;
let effectCursor = 0;

function useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const index = slotCursor++;
  if (!(index in slots)) {
    slots[index] = initial;
  }
  const setState = (next: T | ((previous: T) => T)) => {
    slots[index] =
      typeof next === "function" ? (next as (previous: T) => T)(slots[index] as T) : next;
  };
  return [slots[index] as T, setState];
}

function useRef<T>(current: T): { current: T } {
  const index = slotCursor++;
  if (!(index in slots)) {
    slots[index] = { current };
  }
  return slots[index] as { current: T };
}

function useEffect(effect: () => undefined | (() => void), deps?: readonly unknown[]): void {
  const index = effectCursor++;
  const previous = effects[index];
  const changed =
    !previous ||
    !deps ||
    !previous.deps ||
    deps.some((dependency, position) => !Object.is(dependency, previous.deps?.[position]));
  if (!changed) {
    return;
  }
  pendingEffects.push(() => {
    previous?.cleanup?.();
    effects[index] = { deps, cleanup: effect() ?? undefined };
  });
}

vi.doMock("react", () => ({
  useCallback: <T>(callback: T): T => callback,
  useEffect,
  useMemo: <T>(factory: () => T): T => factory(),
  useRef,
  useState
}));

const scrollMock = vi.fn();
vi.doMock("../src/panels/buildDetails/webview/hooks/consoleSearch", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildConsoleSegments: () => [],
  scrollActiveConsoleMatchIntoView: scrollMock
}));

// Aliased: the test runtime above drives the hook outside a React component.
const { useConsoleSearch: runConsoleSearch } = await import(
  "../src/panels/buildDetails/webview/hooks/useConsoleSearch"
);

type KeyHandler = (event: Partial<KeyboardEvent>) => void;
const keyListeners = new Set<KeyHandler>();
const fakeDocument: { activeElement: unknown; body: object } = { activeElement: null, body: {} };

function render(text: string) {
  slotCursor = 0;
  effectCursor = 0;
  const state = runConsoleSearch(text);
  const run = pendingEffects;
  pendingEffects = [];
  for (const effect of run) {
    effect();
  }
  return state;
}

function pressEscape(): void {
  for (const listener of [...keyListeners]) {
    listener({ key: "Escape", metaKey: false, ctrlKey: false, preventDefault: () => undefined });
  }
}

beforeEach(() => {
  slots.length = 0;
  effects.length = 0;
  pendingEffects = [];
  keyListeners.clear();
  scrollMock.mockClear();
  fakeDocument.activeElement = null;
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: KeyHandler) => keyListeners.add(listener),
    removeEventListener: (_type: string, listener: KeyHandler) => keyListeners.delete(listener)
  });
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useConsoleSearch", () => {
  it("scrolls to the active match on navigation but not on streamed text", () => {
    const text = "error one\nerror two";
    render(text).handleSearchChange({ target: { value: "error" } } as never);
    render(text);
    render(text);
    assert.deepEqual(scrollMock.mock.calls.at(-1), [null, 0]);

    scrollMock.mockClear();
    render(`${text}\nerror three`);
    const state = render(`${text}\nerror three\nerror four`);
    assert.equal(state.matchCount, 4);
    assert.equal(scrollMock.mock.calls.length, 0);

    state.handleSearchStep("next");
    render(`${text}\nerror three\nerror four`);
    assert.deepEqual(scrollMock.mock.calls, [[null, 1]]);
  });

  it("returns focus to the search toggle when Escape closes a focused toolbar", () => {
    const input = {};
    const state = render("log");
    state.openSearchToolbar();
    render("log");
    const focus = vi.fn();
    state.searchToggleRef.current = { isConnected: true, focus } as unknown as HTMLButtonElement;
    state.searchToolbarRef.current = {
      contains: (element: unknown) => element === input
    } as unknown as HTMLDivElement;

    fakeDocument.activeElement = fakeDocument.body;
    pressEscape();
    assert.equal(focus.mock.calls.length, 0);

    render("log").openSearchToolbar();
    render("log");
    fakeDocument.activeElement = input;
    pressEscape();
    assert.equal(focus.mock.calls.length, 1);
    assert.equal(render("log").showSearchToolbar, false);
  });

  it("keeps focus in the open toolbar when Clear empties the query", () => {
    const state = render("log");
    state.openSearchToolbar();
    render("log").handleSearchChange({ target: { value: "lo" } } as never);
    const inputFocus = vi.fn();
    state.searchInputRef.current = { focus: inputFocus } as unknown as HTMLInputElement;

    render("log").handleClearSearch();

    assert.equal(inputFocus.mock.calls.length, 1);
    const cleared = render("log");
    assert.equal(cleared.searchQuery, "");
    assert.equal(cleared.showSearchToolbar, true);
  });
});

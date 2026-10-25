import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

const effects: Array<() => undefined | (() => void)> = [];
const cleanups: Array<() => void> = [];
vi.doMock("react", () => ({
  useCallback: <T>(callback: T): T => callback,
  useEffect: (effect: () => undefined | (() => void)) => effects.push(effect),
  useRef: <T>(current: T) => ({ current }),
  useState: <T>(initial: T) => [initial, vi.fn()]
}));

const { useConsoleOutputScroll: runConsoleOutputScroll } = await import(
  "../src/panels/buildDetails/webview/hooks/useConsoleOutputScroll"
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  effects.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(withCallbacks = true) {
  const output = Object.assign(new EventTarget(), {
    scrollTop: 800,
    scrollHeight: 1000,
    clientHeight: 200,
    scrollTo: vi.fn()
  });
  const ref = { current: output as unknown as HTMLPreElement | null };
  const callbacks = {
    onUserReachBottom: vi.fn(),
    onUserScrollAwayFromBottom: vi.fn()
  };
  const hook = runConsoleOutputScroll(ref, "build-1", withCallbacks ? callbacks : undefined);
  for (const effect of effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  return { output, ref, callbacks, hook };
}

describe("useConsoleOutputScroll", () => {
  it("only reports scrolling caused by recent user input", () => {
    const { output, callbacks } = mount();
    output.scrollTop = 200;
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserScrollAwayFromBottom.mock.calls.length, 0);

    output.dispatchEvent(new Event("wheel"));
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserScrollAwayFromBottom.mock.calls.length, 1);

    output.scrollTop = 800;
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserReachBottom.mock.calls.length, 1);

    vi.advanceTimersByTime(401);
    output.scrollTop = 200;
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserScrollAwayFromBottom.mock.calls.length, 1);
  });

  it("keeps pointer scrolling active until release and ignores unrelated keys", () => {
    const { output, callbacks } = mount();
    output.scrollTop = 200;
    output.dispatchEvent(Object.assign(new Event("keydown"), { key: "a" }));
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserScrollAwayFromBottom.mock.calls.length, 0);

    output.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(1000);
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserScrollAwayFromBottom.mock.calls.length, 1);
    window.dispatchEvent(new Event("pointerup"));
    vi.advanceTimersByTime(401);
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserScrollAwayFromBottom.mock.calls.length, 1);

    output.dispatchEvent(Object.assign(new Event("keydown"), { key: "PageUp" }));
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserScrollAwayFromBottom.mock.calls.length, 2);
  });

  it("does not treat a programmatic jump to the bottom as user scrolling", () => {
    const { output, callbacks, hook } = mount();
    output.dispatchEvent(new Event("touchmove"));
    hook.scrollConsoleToBottom();
    assert.deepEqual(output.scrollTo.mock.calls, [[{ top: 1000, behavior: "auto" }]]);
    output.dispatchEvent(new Event("scroll"));
    assert.equal(callbacks.onUserReachBottom.mock.calls.length, 0);
  });

  it("supports missing callbacks and a detached console and cleans up listeners", () => {
    const { output, ref } = mount(false);
    output.dispatchEvent(new Event("wheel"));
    output.dispatchEvent(new Event("scroll"));
    output.scrollTop = 200;
    output.dispatchEvent(new Event("scroll"));
    ref.current = null;
    output.dispatchEvent(new Event("scroll"));

    const removeListener = vi.spyOn(output, "removeEventListener");
    for (const cleanup of cleanups.splice(0)) cleanup();
    assert.ok(removeListener.mock.calls.some(([event]) => event === "scroll"));
  });
});

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

type ToastModule = typeof import("../src/panels/shared/webview/hooks/useToast");
type ToastStore = ReturnType<ToastModule["useToast"]>;

// The toast store is module-level state, so each test loads a fresh copy and
// reads it through a probe component; every render takes the current snapshot.
async function loadToastStore(): Promise<{
  toast: ToastModule["toast"];
  dismissToast: ToastStore["dismissToast"];
  snapshot: () => ToastStore["toasts"];
}> {
  vi.resetModules();
  const { toast, useToast } = await import("../src/panels/shared/webview/hooks/useToast");
  let store: ToastStore | undefined;
  function ToastProbe(): null {
    store = useToast();
    return null;
  }
  const read = (): ToastStore => {
    renderToStaticMarkup(createElement(ToastProbe));
    if (!store) {
      throw new Error("Toast probe did not render.");
    }
    return store;
  };
  return {
    toast,
    dismissToast: read().dismissToast,
    snapshot: () => read().toasts
  };
}

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismisses after the duration and removes 300ms later", async () => {
    const { toast, snapshot } = await loadToastStore();
    const { id } = toast({ title: "Saved" });

    assert.deepEqual(
      snapshot().map((entry) => [entry.id, entry.open]),
      [[id, true]]
    );

    vi.advanceTimersByTime(2999);
    assert.equal(snapshot()[0]?.open, true);

    vi.advanceTimersByTime(1);
    assert.equal(snapshot()[0]?.open, false);

    vi.advanceTimersByTime(299);
    assert.equal(snapshot().length, 1);

    vi.advanceTimersByTime(1);
    assert.equal(snapshot().length, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("cancels the auto-dismiss timer when dismissed early", async () => {
    const { toast, snapshot } = await loadToastStore();
    const handle = toast({ title: "Saved", durationMs: 1000 });

    vi.advanceTimersByTime(100);
    handle.dismiss();
    assert.equal(snapshot()[0]?.open, false);
    assert.equal(vi.getTimerCount(), 1);

    vi.advanceTimersByTime(300);
    assert.equal(snapshot().length, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("caps the list at five toasts and clears the evicted toast's timer", async () => {
    const { toast, snapshot } = await loadToastStore();
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      vi.advanceTimersByTime(1);
      ids.push(toast({ title: `Toast ${index}` }).id);
    }

    assert.equal(snapshot().length, 5);
    assert.deepEqual(
      snapshot().map((entry) => entry.id),
      ids.slice(1).reverse()
    );
    assert.equal(vi.getTimerCount(), 5);

    vi.advanceTimersByTime(3000);
    assert.ok(snapshot().every((entry) => !entry.open));

    vi.advanceTimersByTime(300);
    assert.equal(snapshot().length, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("dismisses and later removes only the toast with the given id", async () => {
    const { toast, dismissToast, snapshot } = await loadToastStore();
    const first = toast({ title: "One", durationMs: 10_000 });
    const second = toast({ title: "Two", durationMs: 10_000 });

    dismissToast(first.id);
    assert.deepEqual(
      snapshot().map((entry) => [entry.id, entry.open]),
      [
        [second.id, true],
        [first.id, false]
      ]
    );
    assert.equal(vi.getTimerCount(), 2);

    vi.advanceTimersByTime(300);
    assert.deepEqual(
      snapshot().map((entry) => entry.id),
      [second.id]
    );
    assert.equal(vi.getTimerCount(), 1);
  });
});

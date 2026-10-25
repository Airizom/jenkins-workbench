import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

let mountEffect: (() => undefined | (() => void)) | undefined;
let cleanup: (() => void) | undefined;
vi.doMock("react", () => ({
  useEffect: (effect: () => undefined | (() => void)) => {
    mountEffect = effect;
  }
}));

const { useHorizontalOverflow } = await import(
  "../src/panels/shared/webview/hooks/useHorizontalOverflow"
);

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  mountEffect = undefined;
  vi.unstubAllGlobals();
});

describe("useHorizontalOverflow", () => {
  it.each([false, true])(
    "reveals an inserted active child (reduced motion: %s)",
    (reducedMotion) => {
      let onMutation: ((records: Array<Pick<MutationRecord, "type">>) => void) | undefined;
      vi.stubGlobal(
        "MutationObserver",
        class {
          constructor(callback: NonNullable<typeof onMutation>) {
            onMutation = callback;
          }
          observe() {}
          disconnect() {}
        }
      );
      vi.stubGlobal("ResizeObserver", undefined);
      vi.stubGlobal("document", {
        body: {
          classList: {
            contains: (name: string) => reducedMotion && name === "vscode-reduce-motion"
          }
        }
      });

      let activeChild: { getBoundingClientRect: () => { left: number; width: number } } | null =
        null;
      const strip = {
        scrollLeft: 0,
        scrollWidth: 100,
        clientWidth: 100,
        toggleAttribute: vi.fn(),
        querySelector: vi.fn(() => activeChild),
        getBoundingClientRect: () => ({ left: 10 }),
        scrollTo: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      useHorizontalOverflow({ current: strip as unknown as HTMLElement }, '[data-state="active"]');
      assert.ok(mountEffect);
      cleanup = mountEffect() ?? undefined;
      assert.equal(strip.scrollTo.mock.calls.length, 0);

      activeChild = { getBoundingClientRect: () => ({ left: 210, width: 50 }) };
      strip.scrollWidth = 300;
      assert.ok(onMutation);
      onMutation([{ type: "childList" }]);

      assert.deepEqual(strip.toggleAttribute.mock.lastCall, ["data-overflow-end", true]);
      assert.deepEqual(strip.querySelector.mock.lastCall, ['[data-state="active"]']);
      assert.deepEqual(strip.scrollTo.mock.calls, [
        [{ left: 174, behavior: reducedMotion ? "auto" : "smooth" }]
      ]);

      // Later child-list churn keeps a manual scroll while the same item stays active.
      strip.scrollLeft = 0;
      onMutation([{ type: "childList" }]);
      assert.equal(strip.scrollTo.mock.calls.length, 1);

      onMutation([{ type: "attributes" }]);
      assert.equal(strip.scrollTo.mock.calls.length, 2);
    }
  );
});

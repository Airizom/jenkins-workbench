import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  computeActiveMatchScrollPosition,
  scrollActiveConsoleMatchIntoView
} from "../src/panels/buildDetails/webview/hooks/consoleSearch/activeMatchScroll";

const output = {
  scrollTop: 500,
  scrollLeft: 0,
  clientTop: 1,
  clientLeft: 1,
  clientWidth: 400,
  clientHeight: 200
};

describe("computeActiveMatchScrollPosition", () => {
  it("centers the match vertically within the output", () => {
    const position = computeActiveMatchScrollPosition(
      output,
      { top: 100, left: 10 },
      { top: 401, left: 51, width: 40, height: 20 }
    );

    // 300px below the output's top edge, centered in a 200px viewport.
    assert.deepEqual(position, { top: 500 + 300 - 90, left: 0 });
  });

  it("scrolls horizontally only when the match is clipped", () => {
    const right = computeActiveMatchScrollPosition(
      output,
      { top: 0, left: 0 },
      { top: 1, left: 381, width: 40, height: 20 }
    );
    const left = computeActiveMatchScrollPosition(
      { ...output, scrollLeft: 300 },
      { top: 0, left: 0 },
      { top: 1, left: -49, width: 40, height: 20 }
    );

    assert.equal(right.left, 380 + 40 - 400 + 16);
    assert.equal(left.left, 300 - 50 - 16);
  });

  it("never returns negative offsets", () => {
    assert.deepEqual(
      computeActiveMatchScrollPosition(
        { ...output, scrollTop: 0 },
        { top: 0, left: 0 },
        { top: 1, left: -100, width: 10, height: 20 }
      ),
      { top: 0, left: 0 }
    );
  });
});

describe("scrollActiveConsoleMatchIntoView", () => {
  it("scrolls the output element instead of the page", () => {
    const scrollIntoView = vi.fn();
    const match = {
      scrollIntoView,
      getBoundingClientRect: () => ({ top: 401, left: 51, width: 40, height: 20 })
    };
    const scrollTo = vi.fn();
    const querySelector = vi.fn(() => match);
    const element = {
      ...output,
      querySelector,
      scrollTo,
      getBoundingClientRect: () => ({ top: 100, left: 10 })
    } as unknown as HTMLPreElement;

    scrollActiveConsoleMatchIntoView(element, 3);

    assert.deepEqual(querySelector.mock.calls, [['[data-match-index="3"]']]);
    assert.deepEqual(scrollTo.mock.calls, [[{ top: 710, left: 0 }]]);
    assert.equal(scrollIntoView.mock.calls.length, 0);
  });
});

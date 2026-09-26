import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  clampZoomScale,
  createFittedViewport
} from "../src/panels/buildDetails/webview/components/buildDetails/pipelineGraph/pipelineGraphViewport";

describe("createFittedViewport", () => {
  it("scales below the manual zoom minimum so a wide layout fits entirely", () => {
    const layout = { width: 2000, height: 200 };
    const container = { clientWidth: 800, clientHeight: 440 };

    const viewport = createFittedViewport(layout, container, { allowBelowMinimum: true });

    assert.ok(viewport.scale < 0.45);
    assert.ok(viewport.x >= 0);
    assert.ok(viewport.y >= 0);
    assert.ok(viewport.x + layout.width * viewport.scale <= container.clientWidth);
    assert.ok(viewport.y + layout.height * viewport.scale <= container.clientHeight);
  });

  it("keeps automatic fitting at the readable zoom minimum", () => {
    const viewport = createFittedViewport(
      { width: 2000, height: 200 },
      { clientWidth: 800, clientHeight: 440 }
    );

    assert.equal(viewport.scale, 0.45);
  });

  it("does not enlarge small layouts beyond their natural size", () => {
    const viewport = createFittedViewport(
      { width: 200, height: 100 },
      { clientWidth: 800, clientHeight: 440 }
    );

    assert.equal(viewport.scale, 1);
    assert.equal(viewport.x, 300);
    assert.equal(viewport.y, 170);
  });
});

describe("clampZoomScale", () => {
  it("keeps manual zoom within the normal range", () => {
    assert.equal(clampZoomScale(0.5, 0.4), 0.45);
    assert.equal(clampZoomScale(1.8, 2), 1.85);
  });

  it("lets zoom in from a fitted scale below the minimum without jumping", () => {
    assert.ok(Math.abs(clampZoomScale(0.2, 0.22) - 0.22) < 1e-9);
    assert.equal(clampZoomScale(0.2, 0.18), 0.2);
  });
});

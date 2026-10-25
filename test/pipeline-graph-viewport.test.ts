import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  clampZoomScale,
  createFittedViewport,
  recenterViewportOnResize,
  resolveCanvasHeight,
  revealRectInViewport
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

    assert.equal(viewport.scale, 0.8);
  });

  it("aligns an overflowing layout to its start edge instead of centring it", () => {
    const viewport = createFittedViewport(
      { width: 2000, height: 200 },
      { clientWidth: 800, clientHeight: 440 }
    );

    assert.equal(viewport.x, 40);
    assert.equal(viewport.y, (440 - 200 * 0.8) / 2);
  });
});

describe("resolveCanvasHeight", () => {
  it("fits short layouts and caps tall ones", () => {
    assert.equal(resolveCanvasHeight({ height: 60 }), 220);
    assert.equal(resolveCanvasHeight({ height: 200 }), 280);
    assert.equal(resolveCanvasHeight({ height: 900 }), 440);
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

describe("revealRectInViewport", () => {
  const container = { clientWidth: 400, clientHeight: 300 };

  it("keeps the same viewport when the rect is already visible", () => {
    const viewport = { scale: 1, x: 0, y: 0 };

    assert.equal(
      revealRectInViewport(viewport, { x: 50, y: 50, width: 100, height: 60 }, container),
      viewport
    );
  });

  it("pans a rect beyond the right and bottom edges into view without zooming", () => {
    const viewport = { scale: 0.5, x: 0, y: 0 };

    const next = revealRectInViewport(
      viewport,
      { x: 1000, y: 700, width: 200, height: 100 },
      container
    );

    assert.equal(next.scale, 0.5);
    assert.equal(next.x + (1000 + 200) * 0.5, container.clientWidth - 24);
    assert.equal(next.y + (700 + 100) * 0.5, container.clientHeight - 24);
  });

  it("aligns the start edge of a rect left of or above the viewport", () => {
    const next = revealRectInViewport(
      { scale: 1, x: -500, y: -200 },
      { x: 100, y: 50, width: 80, height: 40 },
      container
    );

    assert.equal(next.x + 100, 24);
    assert.equal(next.y + 50, 24);
  });
});

describe("recenterViewportOnResize", () => {
  it("keeps the user's zoom and the centred layout point when the canvas grows", () => {
    const viewport = { scale: 1.5, x: -120, y: 30 };
    const previous = { clientWidth: 600, clientHeight: 360 };
    const next = { clientWidth: 900, clientHeight: 440 };

    const resized = recenterViewportOnResize(viewport, previous, next);

    assert.equal(resized.scale, 1.5);
    const centreBefore = (previous.clientWidth / 2 - viewport.x) / viewport.scale;
    const centreAfter = (next.clientWidth / 2 - resized.x) / resized.scale;
    assert.equal(centreAfter, centreBefore);
    assert.equal(resized.y, 70);
  });

  it("returns the same viewport when the size is unchanged", () => {
    const viewport = { scale: 0.3, x: 10, y: 20 };
    const size = { clientWidth: 500, clientHeight: 300 };

    assert.equal(recenterViewportOnResize(viewport, size, { ...size }), viewport);
  });
});

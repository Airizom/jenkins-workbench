import type { PipelineGraphLayoutResult } from "./pipelineGraphTypes";

const CANVAS_PADDING = 40;
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.85;
const MAX_FIT_SCALE = 1;

export interface ViewportState {
  scale: number;
  x: number;
  y: number;
}

export interface ViewportContainerSize {
  clientWidth: number;
  clientHeight: number;
}

// Automatic fitting keeps the readable zoom minimum; an explicit Fit request may
// go below it so large graphs are shown in full.
export function createFittedViewport(
  layout: Pick<PipelineGraphLayoutResult, "width" | "height">,
  container: ViewportContainerSize,
  options: { allowBelowMinimum?: boolean } = {}
): ViewportState {
  if (layout.width <= 0 || layout.height <= 0) {
    return { scale: 1, x: CANVAS_PADDING, y: CANVAS_PADDING };
  }

  const width = Math.max(container.clientWidth - CANVAS_PADDING * 2, 1);
  const height = Math.max(container.clientHeight - CANVAS_PADDING * 2, 1);
  const fittedScale = Math.min(width / layout.width, height / layout.height, MAX_FIT_SCALE);
  const scale = options.allowBelowMinimum ? fittedScale : Math.max(fittedScale, MIN_SCALE);
  const x = (container.clientWidth - layout.width * scale) / 2;
  const y = (container.clientHeight - layout.height * scale) / 2;
  return { scale, x, y };
}

// Manual zoom respects MIN_SCALE, but never pushes a fitted scale that is
// already below it back up or further down.
export function clampZoomScale(currentScale: number, nextScale: number): number {
  return clamp(nextScale, Math.min(MIN_SCALE, currentScale), MAX_SCALE);
}

const REVEAL_MARGIN = 24;

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pans (never zooms) so a layout-space rect is fully visible with a margin.
 * Returns `viewport` unchanged when the rect is already visible, so callers
 * can pass it straight to a state setter without forcing a re-render.
 */
export function revealRectInViewport(
  viewport: ViewportState,
  rect: ViewportRect,
  container: ViewportContainerSize
): ViewportState {
  const deltaX = revealDelta(
    viewport.x + rect.x * viewport.scale,
    rect.width * viewport.scale,
    container.clientWidth
  );
  const deltaY = revealDelta(
    viewport.y + rect.y * viewport.scale,
    rect.height * viewport.scale,
    container.clientHeight
  );
  if (deltaX === 0 && deltaY === 0) {
    return viewport;
  }
  return { ...viewport, x: viewport.x + deltaX, y: viewport.y + deltaY };
}

function revealDelta(start: number, size: number, available: number): number {
  const end = start + size;
  if (start >= REVEAL_MARGIN && end <= available - REVEAL_MARGIN) {
    return 0;
  }
  // Too large to fit: align the start edge.
  if (size + REVEAL_MARGIN * 2 > available || start < REVEAL_MARGIN) {
    return REVEAL_MARGIN - start;
  }
  return available - REVEAL_MARGIN - end;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

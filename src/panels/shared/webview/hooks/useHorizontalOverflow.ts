import * as React from "react";

/** Width of the `.overflow-fade-x` edge mask in base.css. */
const FADE_WIDTH_PX = 24;
/** Sub-pixel slack so fractional layouts do not report phantom overflow. */
const OVERFLOW_TOLERANCE_PX = 1;

type ScrollMetrics = { scrollLeft: number; scrollWidth: number; clientWidth: number };

export function resolveHorizontalOverflow(metrics: ScrollMetrics): {
  start: boolean;
  end: boolean;
} {
  const maxScrollLeft = metrics.scrollWidth - metrics.clientWidth;
  if (maxScrollLeft <= OVERFLOW_TOLERANCE_PX) {
    return { start: false, end: false };
  }
  return {
    start: metrics.scrollLeft > OVERFLOW_TOLERANCE_PX,
    end: metrics.scrollLeft < maxScrollLeft - OVERFLOW_TOLERANCE_PX
  };
}

/**
 * Horizontal `scrollLeft` that brings an item fully into view, clearing the
 * edge fade, or `undefined` when it is already visible. `itemStart` is the
 * item's offset from the start of the scrollable content.
 */
export function resolveRevealScrollLeft(
  container: { scrollLeft: number; clientWidth: number },
  item: { itemStart: number; itemWidth: number },
  padding = FADE_WIDTH_PX
): number | undefined {
  const itemEnd = item.itemStart + item.itemWidth;
  if (item.itemStart - padding < container.scrollLeft) {
    return Math.max(0, item.itemStart - padding);
  }
  if (itemEnd + padding > container.scrollLeft + container.clientWidth) {
    return itemEnd + padding - container.clientWidth;
  }
  return undefined;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function syncOverflowAttributes(element: HTMLElement): void {
  const { start, end } = resolveHorizontalOverflow(element);
  element.toggleAttribute("data-overflow-start", start);
  element.toggleAttribute("data-overflow-end", end);
}

function revealItem(container: HTMLElement, item: HTMLElement, behavior: ScrollBehavior): void {
  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  // Scrolls only the strip; `scrollIntoView` would also scroll the page
  // vertically when the strip is off screen.
  const target = resolveRevealScrollLeft(container, {
    itemStart: itemRect.left - containerRect.left + container.scrollLeft,
    itemWidth: itemRect.width
  });
  if (target !== undefined) {
    container.scrollTo({ left: target, behavior });
  }
}

/**
 * Tracks horizontal overflow on a scroll strip. Sets `data-overflow-start` /
 * `data-overflow-end` (pair with the `overflow-fade-x` class for edge fades) and
 * scrolls the item matching `activeSelector` into view whenever it changes.
 * Smooth scrolling is skipped under `prefers-reduced-motion`.
 */
export function useHorizontalOverflow<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  activeSelector?: string
): void {
  React.useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const update = (): void => syncOverflowAttributes(element);
    const revealActive = (behavior: ScrollBehavior): void => {
      const active = activeSelector ? element.querySelector<HTMLElement>(activeSelector) : null;
      if (active) {
        revealItem(element, active, behavior);
      }
    };

    update();
    revealActive("auto");

    element.addEventListener("scroll", update, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    resizeObserver?.observe(element);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver((records) => {
            update();
            if (records.some((record) => record.type === "attributes")) {
              revealActive(prefersReducedMotion() ? "auto" : "smooth");
            }
          });
    mutationObserver?.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-state"]
    });

    return () => {
      element.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [ref, activeSelector]);
}

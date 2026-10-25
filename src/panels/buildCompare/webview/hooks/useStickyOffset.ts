import * as React from "react";

const { useLayoutEffect } = React;

/**
 * Mirrors the height of the sticky panel chrome into a CSS custom property on
 * `host`, so section anchors can set `scroll-margin-top` past it. The chrome
 * wraps on narrow panels, so a fixed margin would leave headings underneath.
 */
export function useStickyOffset(
  chromeRef: React.RefObject<HTMLElement | null>,
  hostRef: React.RefObject<HTMLElement | null>,
  propertyName: string
): void {
  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    const host = hostRef.current;
    if (!chrome || !host) {
      return;
    }
    const update = () => {
      host.style.setProperty(propertyName, `${chrome.getBoundingClientRect().height}px`);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, [chromeRef, hostRef, propertyName]);
}

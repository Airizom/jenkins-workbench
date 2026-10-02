import * as React from "react";

const { useCallback, useEffect, useState } = React;

// Show the button once the reader has scrolled half a screen (and at least
// this far) down the page, not only at the very bottom.
const MIN_SCROLL_DISTANCE_PX = 400;

const getScrollElement = (): HTMLElement => {
  const element = document.scrollingElement ?? document.documentElement;
  return element as HTMLElement;
};

export function shouldShowScrollToTop({
  scrollTop,
  clientHeight
}: {
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return scrollTop > Math.max(MIN_SCROLL_DISTANCE_PX, clientHeight / 2);
}

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export type ScrollToTopButtonState = {
  showButton: boolean;
  scrollToTop: () => void;
};
export function useScrollToTopButton(): ScrollToTopButtonState {
  const [showButton, setShowButton] = useState(false);

  const updateVisibility = useCallback(() => {
    setShowButton(shouldShowScrollToTop(getScrollElement()));
  }, []);

  useEffect(() => {
    updateVisibility();

    const handleScroll = () => updateVisibility();
    const handleResize = () => updateVisibility();

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [updateVisibility]);

  const scrollToTop = useCallback(() => {
    const element = getScrollElement();
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    element.scrollTo({ top: 0, behavior });
  }, []);

  return { showButton, scrollToTop };
}

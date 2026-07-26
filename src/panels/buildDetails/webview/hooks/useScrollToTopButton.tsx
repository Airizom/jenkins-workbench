import * as React from "react";

const { useCallback, useEffect, useState } = React;

const BOTTOM_THRESHOLD_PX = 32;

const getScrollElement = (): HTMLElement => {
  const element = document.scrollingElement ?? document.documentElement;
  return element as HTMLElement;
};

const readScrollState = () => {
  const element = getScrollElement();
  const { scrollTop, clientHeight, scrollHeight } = element;
  const isScrollable = scrollHeight - clientHeight > 1;
  const isAtBottom = isScrollable && scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD_PX;

  return { isScrollable, isAtBottom };
};

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export type ScrollToTopButtonState = {
  showButton: boolean;
  scrollToTop: () => void;
};
export function useScrollToTopButton(): ScrollToTopButtonState {
  const [showButton, setShowButton] = useState(false);

  const updateVisibility = useCallback(() => {
    const { isScrollable, isAtBottom } = readScrollState();
    const nextShow = isScrollable && isAtBottom;
    setShowButton(nextShow);
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

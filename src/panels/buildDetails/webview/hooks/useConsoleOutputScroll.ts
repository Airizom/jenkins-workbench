import * as React from "react";

const { useCallback, useEffect, useState } = React;

const CONSOLE_SCROLL_THRESHOLD_PX = 24;

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const readConsoleScrollState = (output: HTMLPreElement) => {
  const { scrollTop, clientHeight, scrollHeight } = output;
  const isScrollable = scrollHeight - clientHeight > 1;
  const isScrolledDown = scrollTop > CONSOLE_SCROLL_THRESHOLD_PX;
  return { isScrollable, isScrolledDown };
};

export function useConsoleOutputScroll(
  consoleOutputRef: React.RefObject<HTMLPreElement>,
  consoleScrollKey: string
) {
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const updateConsoleScrollState = useCallback(() => {
    const output = consoleOutputRef.current;
    if (!output) {
      setShowScrollToTop(false);
      return;
    }

    const { isScrollable, isScrolledDown } = readConsoleScrollState(output);
    const nextShowScrollToTop = isScrollable && isScrolledDown;
    setShowScrollToTop((previous) =>
      previous === nextShowScrollToTop ? previous : nextShowScrollToTop
    );
  }, [consoleOutputRef]);

  useEffect(() => {
    const output = consoleOutputRef.current;
    if (!output) {
      setShowScrollToTop(false);
      return;
    }

    updateConsoleScrollState();

    const handleScroll = () => updateConsoleScrollState();
    const handleResize = () => updateConsoleScrollState();

    output.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      output.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [consoleOutputRef, consoleScrollKey, updateConsoleScrollState]);

  const scrollConsoleToBottom = useCallback(() => {
    const output = consoleOutputRef.current;
    if (!output) {
      return;
    }

    requestAnimationFrame(() => {
      const target = consoleOutputRef.current;
      if (!target) {
        return;
      }
      target.scrollTo({ top: target.scrollHeight, behavior: "auto" });
    });
  }, [consoleOutputRef]);

  const scrollConsoleToTop = useCallback(() => {
    const output = consoleOutputRef.current;
    if (!output) {
      return;
    }

    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    output.scrollTo({ top: 0, behavior });
  }, [consoleOutputRef]);

  return {
    showScrollToTop,
    scrollConsoleToBottom,
    scrollConsoleToTop
  };
}

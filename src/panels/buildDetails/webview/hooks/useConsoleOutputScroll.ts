import * as React from "react";

const { useCallback, useEffect, useRef, useState } = React;

const CONSOLE_SCROLL_THRESHOLD_PX = 24;
// Scroll events only count as user-initiated when they follow a wheel, touch,
// key, or pointer interaction on the console within this window. Programmatic
// scrolls (follow, jump-to-latest) and browser scroll anchoring stay ignored.
const USER_SCROLL_INTENT_WINDOW_MS = 400;

const USER_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " "
]);

export const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export interface ConsoleScrollPosition {
  isScrollable: boolean;
  isScrolledDown: boolean;
  isAtBottom: boolean;
}

export function readConsoleScrollPosition(output: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): ConsoleScrollPosition {
  const { scrollTop, clientHeight, scrollHeight } = output;
  const isScrollable = scrollHeight - clientHeight > 1;
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
  return {
    isScrollable,
    isScrolledDown: scrollTop > CONSOLE_SCROLL_THRESHOLD_PX,
    isAtBottom: !isScrollable || distanceFromBottom <= CONSOLE_SCROLL_THRESHOLD_PX
  };
}

export interface ConsoleOutputScrollCallbacks {
  /** The user scrolled more than the threshold away from the bottom. */
  onUserScrollAwayFromBottom?: () => void;
  /** The user scrolled back to the bottom. */
  onUserReachBottom?: () => void;
}

export function useConsoleOutputScroll(
  consoleOutputRef: React.RefObject<HTMLPreElement | null>,
  consoleScrollKey: string,
  callbacks: ConsoleOutputScrollCallbacks = {}
) {
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const callbacksRef = useRef(callbacks);
  const lastUserIntentRef = useRef(0);
  const pointerActiveRef = useRef(false);

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const updateConsoleScrollState = useCallback(() => {
    const output = consoleOutputRef.current;
    if (!output) {
      setShowScrollToTop(false);
      setIsAtBottom(true);
      return undefined;
    }

    const position = readConsoleScrollPosition(output);
    setShowScrollToTop(position.isScrollable && position.isScrolledDown);
    setIsAtBottom(position.isAtBottom);
    return position;
  }, [consoleOutputRef]);

  useEffect(() => {
    const output = consoleOutputRef.current;
    if (!output) {
      setShowScrollToTop(false);
      setIsAtBottom(true);
      return;
    }

    updateConsoleScrollState();

    const markUserIntent = () => {
      lastUserIntentRef.current = Date.now();
    };
    const hasUserIntent = () =>
      pointerActiveRef.current ||
      Date.now() - lastUserIntentRef.current <= USER_SCROLL_INTENT_WINDOW_MS;

    const handleScroll = () => {
      const position = updateConsoleScrollState();
      if (!position || !hasUserIntent()) {
        return;
      }
      if (position.isAtBottom) {
        callbacksRef.current.onUserReachBottom?.();
      } else {
        callbacksRef.current.onUserScrollAwayFromBottom?.();
      }
    };
    const handleResize = () => updateConsoleScrollState();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (USER_SCROLL_KEYS.has(event.key)) {
        markUserIntent();
      }
    };
    const handlePointerDown = () => {
      pointerActiveRef.current = true;
      markUserIntent();
    };
    const handlePointerUp = () => {
      if (pointerActiveRef.current) {
        pointerActiveRef.current = false;
        markUserIntent();
      }
    };

    output.addEventListener("scroll", handleScroll, { passive: true });
    output.addEventListener("wheel", markUserIntent, { passive: true });
    output.addEventListener("touchmove", markUserIntent, { passive: true });
    output.addEventListener("keydown", handleKeyDown);
    output.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("resize", handleResize);

    return () => {
      output.removeEventListener("scroll", handleScroll);
      output.removeEventListener("wheel", markUserIntent);
      output.removeEventListener("touchmove", markUserIntent);
      output.removeEventListener("keydown", handleKeyDown);
      output.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("resize", handleResize);
    };
  }, [consoleOutputRef, consoleScrollKey, updateConsoleScrollState]);

  const scrollConsoleToBottom = useCallback(() => {
    const output = consoleOutputRef.current;
    if (!output) {
      return;
    }

    // Programmatic: clear any pending intent so the resulting scroll event is
    // not mistaken for the user scrolling.
    lastUserIntentRef.current = 0;
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

    lastUserIntentRef.current = 0;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    output.scrollTo({ top: 0, behavior });
  }, [consoleOutputRef]);

  return {
    showScrollToTop,
    isAtBottom,
    scrollConsoleToBottom,
    scrollConsoleToTop
  };
}

import * as React from "react";
import { prefersReducedMotion } from "../../hooks/useConsoleOutputScroll";

const { useCallback, useEffect, useRef } = React;

// Matches the `xl:` breakpoint where PipelineSection places the log pane beside
// the stage list instead of below it.
const SIDE_BY_SIDE_QUERY = "(min-width: 1280px)";

function isLogPaneStacked(): boolean {
  return !(window.matchMedia?.(SIDE_BY_SIDE_QUERY).matches ?? true);
}

/**
 * When the log pane is stacked under the stage list, a selection there looks
 * like it did nothing. After a user selection this scrolls the pane into view
 * and moves focus to its heading once the selected log is rendered.
 */
export function usePipelineLogPaneReveal(activeTargetKey: string | undefined) {
  const paneRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const pendingKeyRef = useRef<string | undefined>(undefined);

  const reveal = useCallback(() => {
    requestAnimationFrame(() => {
      const pane = paneRef.current;
      if (!pane) {
        return;
      }
      pane.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start"
      });
      headingRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!pendingKeyRef.current || pendingKeyRef.current !== activeTargetKey) {
      return;
    }
    pendingKeyRef.current = undefined;
    reveal();
  }, [activeTargetKey, reveal]);

  // Returns whether the pane will be revealed (only when it is stacked).
  const requestReveal = useCallback(
    (targetKey: string): boolean => {
      if (!isLogPaneStacked()) {
        pendingKeyRef.current = undefined;
        return false;
      }
      if (targetKey === activeTargetKey) {
        pendingKeyRef.current = undefined;
        reveal();
        return true;
      }
      pendingKeyRef.current = targetKey;
      return true;
    },
    [activeTargetKey, reveal]
  );

  return { paneRef, headingRef, requestReveal };
}

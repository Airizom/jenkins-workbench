import * as React from "react";

import { cn } from "../../lib/utils";

const LINE_CLAMP_CLASSES = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3"
} as const;

type ClampedTextProps = {
  text: string;
  /** Lines shown while collapsed. */
  lines?: keyof typeof LINE_CLAMP_CLASSES;
  className?: string;
  /** Classes for the text paragraph itself (color, size). */
  textClassName?: string;
};

/**
 * Multi-line text clamped to `lines`, with the full value in a native `title`
 * and a "Show more" toggle that appears only when the clamp hides text, so
 * long reasons stay reachable by keyboard and screen readers.
 */
export function ClampedText({
  text,
  lines = 2,
  className,
  textClassName
}: ClampedTextProps): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);
  const textRef = React.useRef<HTMLParagraphElement | null>(null);
  const textId = React.useId();

  React.useLayoutEffect(() => {
    const element = textRef.current;
    // Re-measure when the text changes; an empty string never overflows.
    if (!element || expanded || text.length === 0) {
      return;
    }
    const measure = (): void => {
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className={cn("min-w-0", className)}>
      <p
        ref={textRef}
        id={textId}
        className={cn(
          "m-0 [overflow-wrap:anywhere]",
          !expanded && LINE_CLAMP_CLASSES[lines],
          textClassName
        )}
        title={text}
      >
        {text}
      </p>
      {overflowing || expanded ? (
        <button
          type="button"
          className="focus-ring mt-0.5 rounded-sm text-caption text-link hover:text-link-hover hover:underline"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

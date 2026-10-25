import type * as React from "react";

/** Decorative pulsing dot for in-flight loads; pair it with visible or sr-only text. */
export function LoadingDot(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
    />
  );
}

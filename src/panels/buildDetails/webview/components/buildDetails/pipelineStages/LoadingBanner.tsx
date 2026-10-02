import type * as React from "react";
export function LoadingBanner(): React.JSX.Element {
  return (
    <div
      role="status"
      className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-caption font-medium text-muted-foreground"
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-ping motion-reduce:animate-none"
      />
      Refreshing stages...
    </div>
  );
}

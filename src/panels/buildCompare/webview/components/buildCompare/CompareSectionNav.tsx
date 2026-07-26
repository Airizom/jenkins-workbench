import type * as React from "react";
import { cn } from "../../../../shared/webview/lib/utils";
import type { CompareSectionStatus } from "../../../shared/BuildCompareContracts";

export type CompareSectionNavItem = {
  id: string;
  label: string;
  status: CompareSectionStatus;
};

const STATUS_DETAILS: Record<CompareSectionStatus, { dotClassName: string; description: string }> =
  {
    loading: { dotClassName: "bg-muted-foreground animate-shimmer", description: "loading" },
    available: { dotClassName: "bg-progress", description: "has differences" },
    empty: { dotClassName: "bg-muted-foreground/50", description: "no differences" },
    unavailable: { dotClassName: "bg-muted-foreground/50", description: "no data" },
    error: { dotClassName: "bg-failure", description: "failed to load" },
    tooLarge: { dotClassName: "bg-warning", description: "too large to compare" },
    identical: { dotClassName: "bg-success", description: "identical" }
  };

/**
 * The comparison is a long single-column scroll. This rail gives an at-a-glance
 * read of which sections actually diverged and jumps straight to them.
 */
export function CompareSectionNav({
  items
}: {
  items: CompareSectionNavItem[];
}): React.JSX.Element {
  const handleJump = (id: string) => {
    const target = document.getElementById(id);
    if (!target) {
      return;
    }
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    target.scrollIntoView({ behavior, block: "start" });
  };

  return (
    <nav aria-label="Comparison sections" className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const status = STATUS_DETAILS[item.status];
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleJump(item.id)}
            className={cn(
              "focus-ring surface-interactive inline-flex items-center gap-1.5 rounded-full border border-border",
              "bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dotClassName)}
            />
            {item.label}
            <span className="sr-only">: {status.description}</span>
          </button>
        );
      })}
    </nav>
  );
}

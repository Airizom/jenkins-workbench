import type * as React from "react";
import { cn } from "../../../../shared/webview/lib/utils";
import type { CompareNavTone, CompareSectionNavChip } from "./compareSectionNavModel";

export type CompareSectionNavItem = {
  id: string;
  label: string;
  chip: CompareSectionNavChip;
};

const TONE_CLASSES: Record<CompareNavTone, { chip: string; status: string }> = {
  failure: {
    chip: "border-failure-border bg-failure-soft text-foreground",
    status: "text-failure-foreground"
  },
  neutral: {
    chip: "border-border bg-surface text-foreground",
    status: "text-muted-foreground"
  },
  muted: {
    chip: "border-dashed border-border bg-transparent text-muted-foreground",
    status: "italic text-muted-foreground"
  }
};

/**
 * The comparison is a long single-column scroll. This rail states each
 * section's outcome in text and jumps straight to it.
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
        const tone = TONE_CLASSES[item.chip.tone];
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleJump(item.id)}
            className={cn(
              "focus-ring surface-interactive inline-flex items-center gap-1 rounded-full border",
              "px-2.5 py-1 text-xs font-medium hover:border-border-strong",
              tone.chip
            )}
          >
            {item.label}
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <span className={cn("font-normal tabular-nums", tone.status)}>{item.chip.text}</span>
          </button>
        );
      })}
    </nav>
  );
}

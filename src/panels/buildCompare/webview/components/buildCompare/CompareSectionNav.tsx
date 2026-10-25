import type * as React from "react";
import { prefersReducedMotion } from "../../../../shared/webview/lib/motion";
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
 * Moves focus into the section after a jump so keyboard users continue from
 * there: its disclosure button when it has one, otherwise the section itself.
 */
function focusSection(section: HTMLElement): void {
  const trigger = section.querySelector<HTMLElement>("h3 button");
  if (trigger) {
    trigger.focus({ preventScroll: true });
    return;
  }
  section.tabIndex = -1;
  section.focus({ preventScroll: true });
}

/**
 * The comparison is a long single-column scroll. This rail sticks under the
 * header, states each section's outcome in text, and jumps straight to it.
 * Narrow panels keep it to one scrollable row so the sticky chrome stays short.
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
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    target.scrollIntoView({ behavior, block: "start" });
    focusSection(target);
  };

  return (
    <nav
      aria-label="Comparison sections"
      // The padding keeps focus rings clear of the scroll container's clip edge.
      className="-m-0.5 flex gap-1.5 overflow-x-auto p-0.5 [scrollbar-width:thin] sm:flex-wrap"
    >
      {items.map((item) => {
        const tone = TONE_CLASSES[item.chip.tone];
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleJump(item.id)}
            className={cn(
              "focus-ring surface-interactive inline-flex shrink-0 items-center gap-1 rounded-full border whitespace-nowrap",
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

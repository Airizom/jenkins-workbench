import type * as React from "react";
import { cn } from "../lib/utils";

export type TabCountTone = "neutral" | "warning" | "failure";

const TONE_CLASSES: Record<TabCountTone, string> = {
  neutral: "border-border bg-muted-strong text-muted-foreground",
  warning: "border-warning-border bg-warning-badge text-warning",
  failure: "border-failure-border bg-failure-soft text-failure"
};

export function TabCountBadge({
  count,
  tone = "neutral",
  className
}: {
  count: number;
  tone?: TabCountTone;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border px-1",
        "text-[10px] font-semibold tabular-nums",
        TONE_CLASSES[tone],
        className
      )}
    >
      {count}
    </span>
  );
}

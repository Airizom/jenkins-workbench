import type * as React from "react";
import { cn } from "../../../shared/webview/lib/utils";
import { CAPACITY_TONE_TEXT_CLASSES, type CapacityTone } from "../state/nodeCapacityView";

export type ExecutorSegmentCounts = { busy: number; idle: number; offline: number };
export type ExecutorSegmentTones = Partial<Record<keyof ExecutorSegmentCounts, CapacityTone>>;

// Idle uses a foreground tint well above the `bg-muted` track so free capacity
// reads as a segment rather than empty track. `hc-outline` gives every segment
// a contrast border in high-contrast themes.
const CAPACITY_SEGMENTS = [
  { key: "busy", label: "busy", className: "bg-progress" },
  { key: "idle", label: "idle", className: "bg-muted-foreground/45" },
  { key: "offline", label: "offline", className: "bg-warning" }
] as const;

/**
 * Stacked busy/idle/offline split so saturation reads before the numbers do.
 * Each count is labeled directly under the bar with its segment swatch, so the
 * bar needs no separate legend and is hidden from assistive technology; the
 * labeled list carries the numbers.
 */
export function ExecutorCapacityBar({
  counts,
  tones,
  className
}: {
  counts: ExecutorSegmentCounts;
  tones?: ExecutorSegmentTones;
  className?: string;
}): React.JSX.Element {
  const total = counts.busy + counts.idle + counts.offline;
  if (total <= 0) {
    return <p className={cn("m-0 text-xs text-muted-foreground", className)}>No executors</p>;
  }
  return (
    <div className={cn("min-w-0", className)}>
      <div
        aria-hidden="true"
        className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted"
      >
        {CAPACITY_SEGMENTS.map((segment) =>
          counts[segment.key] > 0 ? (
            <span
              key={segment.key}
              className={cn("hc-outline", segment.className)}
              style={{ width: `${(counts[segment.key] / total) * 100}%` }}
            />
          ) : null
        )}
      </div>
      <ul
        aria-label="Executors"
        className="m-0 mt-1.5 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-xs leading-tight text-muted-foreground"
      >
        {CAPACITY_SEGMENTS.map((segment) => {
          const tone = tones?.[segment.key];
          return (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "hc-outline inline-block h-1.5 w-2.5 rounded-full",
                  segment.className
                )}
              />
              <span className={cn(tone && CAPACITY_TONE_TEXT_CLASSES[tone])}>
                <span
                  className={cn("font-semibold tabular-nums", tone ? undefined : "text-foreground")}
                >
                  {counts[segment.key]}
                </span>{" "}
                {segment.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

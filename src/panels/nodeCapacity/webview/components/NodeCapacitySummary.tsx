import * as React from "react";
import { cn } from "../../../shared/webview/lib/utils";
import type { NodeCapacityState } from "../state/nodeCapacityState";

export function NodeCapacitySummary({ state }: { state: NodeCapacityState }): React.JSX.Element {
  // Status tones apply only when a metric signals a problem; zero counts stay
  // neutral so a healthy dashboard reads calm. Each tone is paired with the
  // metric label text, so color is never the only cue.
  const metrics = [
    { label: "Queued", value: state.summary.queuedCount, tone: "text-foreground" },
    {
      label: "Stuck",
      value: state.summary.stuckCount,
      tone: state.summary.stuckCount > 0 ? "text-failure" : "text-foreground"
    },
    { label: "Idle executors", value: state.summary.idleExecutors, tone: "text-foreground" },
    { label: "Busy executors", value: state.summary.busyExecutors, tone: "text-foreground" },
    {
      label: "Offline executors",
      value: state.summary.offlineExecutors,
      tone: state.summary.offlineExecutors > 0 ? "text-warning" : "text-foreground"
    },
    {
      label: "Bottlenecks",
      value: state.summary.bottleneckCount,
      tone: state.summary.bottleneckCount > 0 ? "text-failure" : "text-foreground"
    }
  ];

  return (
    <section aria-label="Capacity summary" className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs"
        >
          <div className={cn("text-2xl font-semibold tabular-nums leading-tight", metric.tone)}>
            {metric.value}
          </div>
          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {metric.label}
          </div>
        </div>
      ))}
    </section>
  );
}

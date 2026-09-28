import type * as React from "react";
import { cn } from "../../../shared/webview/lib/utils";
import type { NodeCapacityState } from "../state/nodeCapacityState";

type SummaryMetric = {
  label: string;
  value: number;
  description: string;
  tone: string;
};

export function NodeCapacitySummary({ state }: { state: NodeCapacityState }): React.JSX.Element {
  const { summary } = state;
  // Status tones apply only when a metric signals a problem; zero counts stay
  // neutral so a healthy dashboard reads calm. Each tone is paired with the
  // metric label and description, so color is never the only cue.
  const metrics: SummaryMetric[] = [
    {
      label: "Queued",
      value: summary.queuedCount,
      description: "Builds waiting to start",
      tone: "text-foreground"
    },
    {
      label: "Stuck",
      value: summary.stuckCount,
      description: "Waiting longer than Jenkins expects",
      tone: summary.stuckCount > 0 ? "text-failure" : "text-foreground"
    },
    {
      label: "Idle executors",
      value: summary.idleExecutors,
      description: "Online and ready for work",
      tone: "text-foreground"
    },
    {
      label: "Busy executors",
      value: summary.busyExecutors,
      description: "Running builds now",
      tone: "text-foreground"
    },
    {
      label: "Offline executors",
      value: summary.offlineExecutors,
      description: "On nodes that are offline",
      tone: summary.offlineExecutors > 0 ? "text-warning" : "text-foreground"
    },
    {
      label: "Saturated pools",
      value: summary.saturatedPoolCount,
      description: "Stuck work, or queued work with no idle executor",
      tone: summary.saturatedPoolCount > 0 ? "text-failure" : "text-foreground"
    }
  ];

  return (
    <section aria-label="Capacity summary">
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex flex-col rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs"
          >
            <dt className="order-2 mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {metric.label}
            </dt>
            <dd
              className={cn(
                "order-1 m-0 text-2xl font-semibold tabular-nums leading-tight",
                metric.tone
              )}
            >
              {metric.value}
            </dd>
            <dd className="order-3 m-0 mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {metric.description}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

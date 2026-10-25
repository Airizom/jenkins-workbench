import type * as React from "react";
import type { NodeCapacitySummaryViewModel } from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { cn } from "../../../shared/webview/lib/utils";
import {
  CAPACITY_TONE_TEXT_CLASSES,
  type CapacityTone,
  resolveIdleTone,
  resolveOfflineTone,
  resolveQueuedTone
} from "../state/nodeCapacityView";
import { ExecutorCapacityBar } from "./ExecutorCapacityBar";

type SummaryMetric = {
  label: string;
  value: number;
  description: string;
  tone?: CapacityTone;
};

const TILE_CLASS = "rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs";

export function NodeCapacitySummary({
  summary
}: {
  summary: NodeCapacitySummaryViewModel;
}): React.JSX.Element {
  // Tones come from the same rules the pools use and apply only when a metric
  // signals a problem, so a healthy dashboard reads calm. Each tone is paired
  // with the metric label and description, so color is never the only cue.
  const metrics: SummaryMetric[] = [
    {
      label: "Queued",
      value: summary.queuedCount,
      description: "Waiting to start",
      tone: resolveQueuedTone(summary)
    },
    {
      label: "Stuck",
      value: summary.stuckCount,
      description: "Past Jenkins' expected wait",
      tone: summary.stuckCount > 0 ? "failure" : undefined
    },
    {
      label: "Saturated pools",
      value: summary.saturatedPoolCount,
      description: "Stuck, or queued with no idle executor",
      tone: summary.saturatedPoolCount > 0 ? "failure" : undefined
    }
  ];
  // Summary busy/idle counts cover online nodes only, and offline executors
  // come from offline nodes, so the three segments never overlap.
  const executorCounts = {
    busy: summary.busyExecutors,
    idle: summary.idleExecutors,
    offline: summary.offlineExecutors
  };

  return (
    <section aria-label="Capacity summary" className="grid gap-2 lg:grid-cols-2">
      <dl className="m-0 grid grid-cols-3 gap-2">
        {metrics.map((metric) => (
          <div key={metric.label} className={cn("flex min-w-0 flex-col", TILE_CLASS)}>
            <dt className="order-2 mt-0.5 text-caption font-medium uppercase tracking-wider text-muted-foreground">
              {metric.label}
            </dt>
            <dd
              className={cn(
                "order-1 m-0 text-2xl font-semibold tabular-nums leading-tight",
                metric.tone ? CAPACITY_TONE_TEXT_CLASSES[metric.tone] : "text-foreground"
              )}
            >
              {metric.value}
            </dd>
            <dd className="order-3 m-0 mt-0.5 text-caption leading-snug text-muted-foreground">
              {metric.description}
            </dd>
          </div>
        ))}
      </dl>
      <div className={cn("flex flex-col justify-center", TILE_CLASS)}>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="m-0 text-caption font-medium uppercase tracking-wider text-muted-foreground">
            Executors
          </h2>
          <span className="text-caption tabular-nums text-muted-foreground">
            {summary.onlineNodes}/{summary.totalNodes} nodes online
          </span>
        </div>
        <ExecutorCapacityBar
          counts={executorCounts}
          tones={{
            idle: resolveIdleTone(summary),
            offline: resolveOfflineTone(summary.offlineExecutors)
          }}
        />
      </div>
    </section>
  );
}

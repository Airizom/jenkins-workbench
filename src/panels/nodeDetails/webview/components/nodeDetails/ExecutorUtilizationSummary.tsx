import type * as React from "react";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import type { NodeExecutorViewModel } from "../../../shared/NodeDetailsContracts";
import { type ExecutorUtilization, summarizeExecutorUtilization } from "./executorUtilization";

type ExecutorUtilizationSummaryProps = {
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  executorsLabel: string;
  activityLabel: string;
  isOffline: boolean;
};
export function ExecutorUtilizationSummary({
  executors,
  oneOffExecutors,
  executorsLabel,
  activityLabel,
  isOffline
}: ExecutorUtilizationSummaryProps): React.JSX.Element {
  const utilization = summarizeExecutorUtilization(executors, oneOffExecutors, isOffline);

  if (utilization.total === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Executors: <span className="font-medium text-foreground">{executorsLabel}</span>
        </span>
        <span>
          Activity: <span className="font-medium text-foreground">{activityLabel}</span>
        </span>
        <OneOffExecutorBadge utilization={utilization} />
      </div>
    );
  }

  const percent = Math.round((utilization.ratio ?? 0) * 100);
  const counts: Array<{ label: string; value: number; muted: boolean }> = isOffline
    ? [
        ...(utilization.busy > 0 ? [{ label: "busy", value: utilization.busy, muted: false }] : []),
        { label: "offline", value: utilization.offline, muted: false }
      ]
    : [
        { label: "busy", value: utilization.busy, muted: false },
        { label: "idle", value: utilization.idle, muted: true }
      ];

  // No role="img" wrapper: the counts and the bar caption are readable text.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <div className="flex items-baseline gap-2 text-xs">
        {counts.map((count) => (
          <span key={count.label} className="inline-flex items-baseline gap-1">
            <span
              className={
                count.muted
                  ? "text-base font-semibold tabular-nums text-muted-foreground"
                  : "text-base font-semibold tabular-nums"
              }
            >
              {count.value}
            </span>
            <span className="text-muted-foreground">{count.label}</span>
          </span>
        ))}
      </div>
      <div className="flex min-w-[140px] max-w-[280px] flex-1 items-center gap-2">
        <div className="monitor-gauge monitor-gauge--lg" data-offline={isOffline || undefined}>
          <div className="monitor-gauge-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
          {isOffline ? "Offline" : `${percent}% busy`}
        </span>
      </div>
      <OneOffExecutorBadge utilization={utilization} />
    </div>
  );
}

function OneOffExecutorBadge({
  utilization
}: {
  utilization: ExecutorUtilization;
}): React.JSX.Element | null {
  if (utilization.oneOffTotal === 0) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 border-border bg-muted-soft text-muted-foreground"
    >
      +{utilization.oneOffBusy}/{utilization.oneOffTotal} one-off
    </Badge>
  );
}

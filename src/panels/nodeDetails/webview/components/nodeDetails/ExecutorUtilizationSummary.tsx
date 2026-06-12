import { Badge } from "../../../../shared/webview/components/ui/badge";
import { cn } from "../../../../shared/webview/lib/utils";
import type { NodeExecutorViewModel } from "../../../shared/NodeDetailsContracts";
import { summarizeExecutorUtilization, utilizationLevel } from "./executorUtilization";

type ExecutorUtilizationSummaryProps = {
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  executorsLabel: string;
  idleLabel: string;
  isOffline: boolean;
};
export function ExecutorUtilizationSummary({
  executors,
  oneOffExecutors,
  executorsLabel,
  idleLabel,
  isOffline
}: ExecutorUtilizationSummaryProps): JSX.Element {
  const utilization = summarizeExecutorUtilization(executors, oneOffExecutors);

  if (utilization.total === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Executors: <span className="font-medium text-foreground">{executorsLabel}</span>
        </span>
        <span>
          Activity: <span className="font-medium text-foreground">{idleLabel}</span>
        </span>
        <OneOffExecutorBadge utilization={utilization} />
      </div>
    );
  }

  const ratio = utilization.ratio ?? 0;
  const percent = Math.round(ratio * 100);

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", isOffline && "opacity-60")}
      role="img"
      aria-label={`${utilization.busy} of ${utilization.total} executors busy`}
    >
      <div className="flex items-baseline gap-2 text-xs">
        <span className="text-base font-semibold tabular-nums">{utilization.busy}</span>
        <span className="text-muted-foreground">busy</span>
        <span className="text-base font-semibold tabular-nums text-muted-foreground">
          {utilization.idle}
        </span>
        <span className="text-muted-foreground">idle</span>
      </div>
      <div className="flex min-w-[140px] max-w-[280px] flex-1 items-center gap-2">
        <div className="monitor-gauge monitor-gauge--lg">
          <div
            className="monitor-gauge-fill"
            data-level={utilizationLevel(ratio)}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <OneOffExecutorBadge utilization={utilization} />
      {isOffline ? <span className="text-[11px] text-muted-foreground">Offline</span> : null}
    </div>
  );
}

function OneOffExecutorBadge({
  utilization
}: {
  utilization: ReturnType<typeof summarizeExecutorUtilization>;
}): JSX.Element | null {
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

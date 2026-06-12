import { Alert, AlertDescription } from "../../../../shared/webview/components/ui/alert";
import { Button } from "../../../../shared/webview/components/ui/button";
import { CpuIcon, GaugeIcon, StatusIcon, TagIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { ExecutorSlotGrid } from "./ExecutorSlotGrid";
import { LabelChips } from "./LabelChips";
import { OverviewCard } from "./OverviewCard";
import { QueuePreviewCard } from "./QueuePreviewCard";
import { summarizeExecutorUtilization } from "./executorUtilization";
import type { OverviewRow } from "./nodeDetailsUtils";

export type NodeDetailsTabTarget = "executors" | "queue" | "diagnostics";

type NodeDetailsOverviewSectionProps = {
  state: NodeDetailsState;
  overviewRows: OverviewRow[];
  onOpenExternal: (url: string) => void;
  onShowTab: (tab: NodeDetailsTabTarget) => void;
};
export function NodeDetailsOverviewSection({
  state,
  overviewRows,
  onOpenExternal,
  onShowTab
}: NodeDetailsOverviewSectionProps): JSX.Element {
  const utilization = summarizeExecutorUtilization(state.executors, state.oneOffExecutors);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 md:items-start">
        <div className="space-y-3">
          <OverviewCard icon={<StatusIcon className="h-4 w-4" />} title="Status">
            <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
              {overviewRows.map((row) => (
                <div key={row.label} className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
                    {row.icon}
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {row.label}
                    </dt>
                    <dd className="m-0 truncate text-xs font-semibold" title={row.value}>
                      {row.value}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
          </OverviewCard>

          <OverviewCard
            icon={<TagIcon className="h-4 w-4" />}
            title="Labels"
            meta={state.labels.length > 0 ? `${state.labels.length}` : undefined}
          >
            <LabelChips labels={state.labels} />
          </OverviewCard>
        </div>

        <div className="space-y-3">
          <OverviewCard
            icon={<CpuIcon className="h-4 w-4" />}
            title="Executors"
            meta={
              utilization.total > 0
                ? `${utilization.busy} busy · ${utilization.idle} idle${
                    utilization.oneOffTotal > 0 ? ` · ${utilization.oneOffTotal} one-off` : ""
                  }`
                : undefined
            }
          >
            {utilization.total > 0 || utilization.oneOffTotal > 0 ? (
              <ExecutorSlotGrid
                executors={state.executors}
                oneOffExecutors={state.oneOffExecutors}
                onOpenExternal={onOpenExternal}
              />
            ) : (
              <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
                {state.executorsLabel === "Not available"
                  ? "Executor data is not available for this node."
                  : state.executorsLabel}
              </div>
            )}
            <Button
              variant="link"
              size="sm"
              className="mt-3 text-xs"
              onClick={() => onShowTab("executors")}
              aria-label="Open the Executors tab"
            >
              View executors
            </Button>
          </OverviewCard>

          <QueuePreviewCard
            queuedWork={state.queuedWork}
            onOpenExternal={onOpenExternal}
            onShowQueue={() => onShowTab("queue")}
          />
        </div>

        <div className="md:col-span-2">
          <MonitorsTeaser state={state} onShowDiagnostics={() => onShowTab("diagnostics")} />
        </div>
      </div>

      {state.offlineReason ? (
        <Alert variant="warning" className="py-2">
          <AlertDescription className="text-xs">
            <span className="font-semibold">Offline reason: </span>
            {state.offlineReason}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function MonitorsTeaser({
  state,
  onShowDiagnostics
}: {
  state: NodeDetailsState;
  onShowDiagnostics: () => void;
}): JSX.Element {
  if (state.advancedLoaded && state.monitorData.length > 0) {
    return (
      <OverviewCard
        icon={<GaugeIcon className="h-4 w-4" />}
        title="Monitors"
        meta={
          <Button
            variant="link"
            size="sm"
            className="text-xs"
            onClick={onShowDiagnostics}
            aria-label="Open the Diagnostics tab"
          >
            Open diagnostics
          </Button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {state.monitorData.slice(0, 3).map((monitor) => (
            <div
              key={monitor.key}
              className="rounded border border-mutedBorder bg-muted-soft px-3 py-2"
            >
              <div className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {monitor.key}
              </div>
              <div className="truncate text-xs font-semibold" title={monitor.summary}>
                {monitor.summary}
              </div>
            </div>
          ))}
        </div>
      </OverviewCard>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-mutedBorder bg-muted-soft px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <GaugeIcon className="h-3.5 w-3.5" />
        {state.advancedLoaded
          ? "No monitor data was reported for this node."
          : "System monitors and load statistics load on first open of the Diagnostics tab."}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="h-6 px-2 text-[11px]"
        onClick={onShowDiagnostics}
      >
        Open diagnostics
      </Button>
    </div>
  );
}

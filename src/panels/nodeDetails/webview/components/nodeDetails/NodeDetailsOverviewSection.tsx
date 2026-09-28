import type * as React from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import { CpuIcon, GaugeIcon, StatusIcon, TagIcon } from "../../../../shared/webview/icons";
import { NODE_DETAILS_TABS, type NodeDetailsTab } from "../../nodeDetailsTabValues";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { ExecutorSlotGrid } from "./ExecutorSlotGrid";
import { formatExecutorCounts, summarizeExecutorUtilization } from "./executorUtilization";
import { LabelChips } from "./LabelChips";
import { formatMonitorLabel } from "./monitorLabels";
import { buildConnectionRows, buildStatusRows } from "./nodeDetailsUtils";
import { OverviewCard } from "./OverviewCard";
import { QueuePreviewCard } from "./QueuePreviewCard";

type NodeDetailsOverviewSectionProps = {
  state: NodeDetailsState;
  onOpenExternal: (url: string) => void;
  onShowTab: (tab: NodeDetailsTab) => void;
};
/**
 * The offline reason is intentionally not repeated here: the hero banner
 * already shows it and stays visible across tabs.
 */
export function NodeDetailsOverviewSection({
  state,
  onOpenExternal,
  onShowTab
}: NodeDetailsOverviewSectionProps): React.JSX.Element {
  const utilization = summarizeExecutorUtilization(
    state.executors,
    state.oneOffExecutors,
    state.isOffline
  );
  const executorSummary = formatExecutorSummary(utilization);
  const statusRows = buildStatusRows(state);
  const connectionRows = buildConnectionRows(state);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 md:items-start">
        <div className="space-y-3">
          <OverviewCard icon={<StatusIcon className="h-4 w-4" />} title="Status">
            <dl className="m-0 grid gap-x-4 gap-y-2.5 sm:grid-cols-3">
              {statusRows.map((row) => (
                <div key={row.label} className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                    {row.icon}
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
                    <dd className="m-0 truncate text-xs font-semibold" title={row.value}>
                      {row.value}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
            {connectionRows.length > 0 ? (
              <div className="mt-3 border-t border-border pt-2.5">
                <h3 className="m-0 mb-1.5 text-[11px] font-medium text-muted-foreground">
                  Connection
                </h3>
                <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  {connectionRows.map((row) => (
                    <div key={row.label} className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="text-muted-foreground">
                        {row.icon}
                      </span>
                      <dt className="text-muted-foreground">{row.label}:</dt>
                      <dd className="m-0 font-medium">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
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
            meta={executorSummary}
          >
            {utilization.total > 0 || utilization.oneOffTotal > 0 ? (
              <ExecutorSlotGrid
                executors={state.executors}
                oneOffExecutors={state.oneOffExecutors}
                isOffline={state.isOffline}
                onOpenExternal={onOpenExternal}
                onViewAll={() => onShowTab(NODE_DETAILS_TABS.EXECUTORS)}
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
              onClick={() => onShowTab(NODE_DETAILS_TABS.EXECUTORS)}
              aria-label="Open the Executors tab"
            >
              View executors
            </Button>
          </OverviewCard>

          <QueuePreviewCard
            queuedWork={state.queuedWork}
            onOpenExternal={onOpenExternal}
            onShowQueue={() => onShowTab(NODE_DETAILS_TABS.QUEUE)}
          />
        </div>

        <div className="md:col-span-2">
          <MonitorsTeaser
            state={state}
            onShowDiagnostics={() => onShowTab(NODE_DETAILS_TABS.DIAGNOSTICS)}
          />
        </div>
      </div>
    </div>
  );
}

function formatExecutorSummary(
  utilization: ReturnType<typeof summarizeExecutorUtilization>
): string | undefined {
  if (utilization.total === 0) {
    return undefined;
  }

  let summary = formatExecutorCounts(utilization);
  if (utilization.oneOffTotal > 0) {
    summary += ` · ${utilization.oneOffTotal} one-off`;
  }
  return summary;
}

function MonitorsTeaser({
  state,
  onShowDiagnostics
}: {
  state: NodeDetailsState;
  onShowDiagnostics: () => void;
}): React.JSX.Element {
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
              <div className="truncate text-[11px] text-muted-foreground" title={monitor.key}>
                {formatMonitorLabel(monitor.key)}
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

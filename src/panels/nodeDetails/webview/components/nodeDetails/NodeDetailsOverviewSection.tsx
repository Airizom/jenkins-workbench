import type * as React from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import { CpuIcon, GaugeIcon, TagIcon, TerminalIcon } from "../../../../shared/webview/icons";
import { NODE_DETAIL_NOT_AVAILABLE_LABEL } from "../../../shared/NodeDetailsContracts";
import { NODE_DETAILS_TABS, type NodeDetailsTab } from "../../nodeDetailsTabValues";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { ExecutorSlotGrid } from "./ExecutorSlotGrid";
import { LabelChips } from "./LabelChips";
import { formatMonitorLabel } from "./monitorLabels";
import { buildConnectionRows } from "./nodeDetailsUtils";
import { OverviewCard } from "./OverviewCard";
import { QueuePreviewCard } from "./QueuePreviewCard";

type NodeDetailsOverviewSectionProps = {
  state: NodeDetailsState;
  onOpenExternal: (url: string) => void;
  onShowTab: (tab: NodeDetailsTab) => void;
};
/**
 * The hero stays visible across tabs and already states the status, offline
 * reason and time, and executor counts, so the Overview does not repeat them:
 * it shows per-slot executors, queued work, labels, and connection facts.
 */
export function NodeDetailsOverviewSection({
  state,
  onOpenExternal,
  onShowTab
}: NodeDetailsOverviewSectionProps): React.JSX.Element {
  const connectionRows = buildConnectionRows(state);
  const hasExecutors = state.executors.length > 0 || state.oneOffExecutors.length > 0;

  return (
    <div className="grid gap-3 md:grid-cols-2 md:items-start">
      <div className="space-y-3">
        <OverviewCard icon={<CpuIcon className="h-4 w-4" />} title="Executors">
          {hasExecutors ? (
            <>
              <ExecutorSlotGrid
                executors={state.executors}
                oneOffExecutors={state.oneOffExecutors}
                isOffline={state.isOffline}
                onOpenExternal={onOpenExternal}
                onViewAll={() => onShowTab(NODE_DETAILS_TABS.EXECUTORS)}
              />
              <Button
                variant="link"
                size="sm"
                className="mt-3 text-xs"
                onClick={() => onShowTab(NODE_DETAILS_TABS.EXECUTORS)}
                aria-label="Open the Executors tab"
              >
                View executors
              </Button>
            </>
          ) : (
            <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
              {state.executorsLabel === NODE_DETAIL_NOT_AVAILABLE_LABEL
                ? "Executor data is not available for this node."
                : "This node has no executors."}
            </div>
          )}
        </OverviewCard>

        <QueuePreviewCard
          queuedWork={state.queuedWork}
          onOpenExternal={onOpenExternal}
          onShowQueue={() => onShowTab(NODE_DETAILS_TABS.QUEUE)}
        />
      </div>

      <div className="space-y-3">
        <OverviewCard
          icon={<TagIcon className="h-4 w-4" />}
          title="Labels"
          meta={state.labels.length > 0 ? `${state.labels.length}` : undefined}
        >
          <LabelChips labels={state.labels} />
        </OverviewCard>

        {connectionRows.length > 0 ? (
          <OverviewCard icon={<TerminalIcon className="h-4 w-4" />} title="Connection">
            <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-xs">
              {connectionRows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <span aria-hidden="true">{row.icon}</span>
                    {row.label}
                  </dt>
                  <dd className="m-0 font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </OverviewCard>
        ) : null}
      </div>

      <div className="md:col-span-2">
        <MonitorsTeaser
          state={state}
          onShowDiagnostics={() => onShowTab(NODE_DETAILS_TABS.DIAGNOSTICS)}
        />
      </div>
    </div>
  );
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
              <div className="truncate text-caption text-muted-foreground" title={monitor.key}>
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
          : "Disk space, swap, clock, and response-time monitors, plus load statistics."}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="h-6 px-2 text-caption"
        onClick={onShowDiagnostics}
      >
        Open diagnostics
      </Button>
    </div>
  );
}

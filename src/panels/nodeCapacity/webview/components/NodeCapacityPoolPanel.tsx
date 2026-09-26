import * as React from "react";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacitySeverity
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { EmptyState } from "../../../shared/webview/components/EmptyState";
import { SectionHeading } from "../../../shared/webview/components/SectionHeading";
import { ToneBadge } from "../../../shared/webview/components/ToneBadge";
import { Badge } from "../../../shared/webview/components/ui/badge";
import { Button } from "../../../shared/webview/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../shared/webview/components/ui/tooltip";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  ServerIcon
} from "../../../shared/webview/icons";
import { resolveSeverityBadgeClass } from "../../../shared/webview/lib/statusStyles";
import { cn } from "../../../shared/webview/lib/utils";
import { NodeCapacityQueueList } from "./NodeCapacityQueue";
import type { OpenExternalHandler, OpenNodeDetailsHandler } from "./NodeCapacityViewTypes";

const POOL_SEVERITY_BORDER_CLASSES: Record<NodeCapacitySeverity, string> = {
  critical: "border-failure-border",
  warning: "border-warning-border",
  normal: "border-border"
};

/**
 * `<details>` fires `toggle` for every change to its `open` attribute,
 * including the ones React applies when the controlled `isOpen` prop changes
 * (for example a pool auto-expanding on abnormal severity). Only a user
 * interaction leaves the DOM state out of sync with the prop, so only that
 * case should be recorded as an explicit override.
 */
export function isUserInitiatedPoolToggle(domOpen: boolean, controlledOpen: boolean): boolean {
  return domOpen !== controlledOpen;
}

/**
 * Memoized so collapsed/untouched pools skip their whole subtree when the app
 * re-renders on clock ticks, unrelated pool toggles, or header-only updates;
 * pool/node view models keep stable identities between those renders.
 */
export const NodeCapacityPoolPanel = React.memo(function NodeCapacityPoolPanel({
  pool,
  isOpen,
  onOpenExternal,
  onOpenNodeDetails,
  onToggleExpanded
}: {
  pool: NodeCapacityPoolViewModel;
  isOpen: boolean;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onToggleExpanded: (poolId: string, open: boolean) => void;
}): React.JSX.Element {
  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const domOpen = event.currentTarget.open;
    if (!isUserInitiatedPoolToggle(domOpen, isOpen)) {
      return;
    }
    onToggleExpanded(pool.id, domOpen);
  };

  return (
    <details
      className={cn(
        "capacity-pool rounded-lg border bg-card shadow-sm",
        POOL_SEVERITY_BORDER_CLASSES[pool.severity]
      )}
      open={isOpen}
      onToggle={handleToggle}
    >
      <summary className="cursor-pointer list-none rounded-lg px-4 py-3 transition-colors hover:bg-accent-soft">
        <div className="grid gap-3 lg:grid-cols-6 lg:items-center">
          <div className="flex min-w-0 items-start gap-2 lg:col-span-2">
            <ChevronDownIcon
              aria-hidden="true"
              className="capacity-pool-chevron mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{pool.label}</h2>
                <ToneBadge
                  label={pool.statusLabel}
                  className={resolveSeverityBadgeClass(pool.severity)}
                />
                {pool.kind === "any" ? (
                  <Badge variant="outline" size="sm">
                    unassigned
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {pool.onlineNodes}/{pool.totalNodes} nodes online
                {pool.offlineExecutors > 0 ? ` · ${pool.offlineExecutors} offline executors` : ""}
              </div>
              <ExecutorCapacityBar
                total={pool.totalExecutors}
                busy={pool.busyExecutors}
                idle={pool.idleExecutors}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:contents">
            <PoolMetric label="Queued" value={pool.queuedCount} />
            <PoolMetric label="Idle" value={pool.idleExecutors} />
            <PoolMetric label="Busy" value={pool.busyExecutors} />
            <PoolMetric label="Offline" value={pool.offlineExecutors} />
          </div>
        </div>
      </summary>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <NodeList
          nodes={pool.nodes}
          onOpenNodeDetails={onOpenNodeDetails}
          onOpenExternal={onOpenExternal}
        />
        <NodeCapacityQueueList items={pool.queueItems} onOpenExternal={onOpenExternal} />
        {pool.offlineImpact.length > 0 ? (
          <div className="lg:col-span-2">
            <SectionHeading
              title="Offline capacity impact"
              icon={<AlertTriangleIcon className="h-3.5 w-3.5 text-warning" />}
              count={pool.offlineImpact.length}
            />
            <div className="grid gap-2 md:grid-cols-2">
              {pool.offlineImpact.map((item) => (
                <div
                  key={`${item.nodeName}:${item.executors}`}
                  className="rounded-md border border-warning-border bg-warning-soft p-3"
                >
                  <div className="text-sm font-medium">{item.nodeName}</div>
                  <div className="mt-1 text-xs text-warning-foreground">
                    {item.executors} executor{item.executors === 1 ? "" : "s"} unavailable
                  </div>
                  {item.reason ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
});

const CAPACITY_SEGMENTS = [
  { key: "busy", label: "busy", className: "bg-progress" },
  { key: "idle", label: "idle", className: "bg-muted-strong" },
  { key: "offline", label: "offline", className: "bg-warning" }
] as const;

/**
 * Stacked busy/idle/offline split so saturation reads before the numbers do.
 * Pool `offlineExecutors` also counts builds still running on draining nodes
 * (already in `busy`), so the offline segment is whatever capacity remains.
 */
function ExecutorCapacityBar({
  total,
  busy,
  idle
}: {
  total: number;
  busy: number;
  idle: number;
}): React.JSX.Element | null {
  if (total <= 0) {
    return null;
  }
  const counts = { busy, idle, offline: Math.max(0, total - busy - idle) };
  const description = CAPACITY_SEGMENTS.map(
    (segment) => `${counts[segment.key]} ${segment.label}`
  ).join(", ");
  return (
    <div
      role="img"
      aria-label={`Executors: ${description}`}
      title={description}
      className="mt-2 flex h-1.5 w-full max-w-64 gap-px overflow-hidden rounded-full bg-muted"
    >
      {CAPACITY_SEGMENTS.map((segment) =>
        counts[segment.key] > 0 ? (
          <span
            key={segment.key}
            className={segment.className}
            style={{ width: `${(counts[segment.key] / total) * 100}%` }}
          />
        ) : null
      )}
    </div>
  );
}

function PoolMetric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3 py-1.5">
      <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/**
 * Memoized so toggling a pool open/closed does not re-render every node row;
 * capacity data updates always replace the `nodes` array, so real changes
 * still re-render.
 */
const NodeList = React.memo(function NodeList({
  nodes,
  onOpenNodeDetails,
  onOpenExternal
}: {
  nodes: NodeCapacityNodeViewModel[];
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  if (nodes.length === 0) {
    return (
      <section>
        <SectionHeading title="Nodes" icon={<ServerIcon className="h-3.5 w-3.5" />} />
        <EmptyState
          tone="failure"
          icon={<AlertTriangleIcon className="h-4 w-4" />}
          title="No nodes provide this label"
          description="Queued builds requesting it cannot start until a matching agent comes online."
        />
      </section>
    );
  }

  return (
    <section>
      <SectionHeading
        title="Nodes"
        icon={<ServerIcon className="h-3.5 w-3.5" />}
        count={nodes.length}
      />
      <div className="space-y-2">
        {nodes.map((node) => (
          <div
            key={node.nodeUrl ?? node.name}
            className={cn(
              "rounded-md border p-3",
              node.isOffline
                ? "border-warning-border bg-warning-soft"
                : "border-border bg-surface-sunken"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{node.displayName}</span>
                  <Badge variant={node.isOffline ? "secondary" : "muted"}>{node.statusLabel}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{node.executorSummary}</div>
                {node.offlineReason ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {node.offlineReason}
                  </p>
                ) : null}
                {node.executorsLoaded &&
                (!node.isOffline || node.executors.some((executor) => !executor.isIdle)) ? (
                  <ExecutorWorkList node={node} onOpenExternal={onOpenExternal} />
                ) : null}
              </div>
              <div className="flex shrink-0 gap-0.5">
                {node.nodeUrl ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={`Open node details for ${node.displayName}`}
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          node.nodeUrl && onOpenNodeDetails(node.nodeUrl, node.displayName)
                        }
                      >
                        <ServerIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open node details</TooltipContent>
                  </Tooltip>
                ) : null}
                {node.nodeUrl ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={`Open ${node.displayName} in Jenkins`}
                        variant="ghost"
                        size="icon"
                        onClick={() => node.nodeUrl && onOpenExternal(node.nodeUrl)}
                      >
                        <ExternalLinkIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open in Jenkins</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
});

function ExecutorWorkList({
  node,
  onOpenExternal
}: {
  node: NodeCapacityNodeViewModel;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  const busyExecutors = node.executors.filter((executor) => !executor.isIdle);
  if (busyExecutors.length === 0) {
    return <div className="mt-2 text-xs text-muted-foreground">No running work loaded.</div>;
  }

  return (
    <ul className="mt-2 m-0 list-none space-y-0.5 border-l border-border p-0 pl-2.5">
      {busyExecutors.map((executor) => {
        const label = executor.workLabel ?? executor.statusLabel;
        const workUrl = executor.workUrl;
        return (
          <li key={executor.id} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="w-6 shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {executor.id}
            </span>
            {workUrl ? (
              <button
                type="button"
                className="focus-ring group flex min-w-0 items-center gap-1 rounded-sm text-left text-link hover:text-link-hover hover:underline"
                aria-label={`Open ${label} running on ${node.displayName}`}
                onClick={() => onOpenExternal(workUrl)}
              >
                <span className="truncate">{label}</span>
                <ExternalLinkIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ) : (
              <span className="truncate">{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

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
import { ClampedText } from "../../../shared/webview/components/ui/clamped-text";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../shared/webview/components/ui/tooltip";
import { TruncatedText } from "../../../shared/webview/components/ui/truncated-text";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ServerIcon
} from "../../../shared/webview/icons";
import {
  resolveNodeStatusBadgeClass,
  resolveSeverityBadgeClass
} from "../../../shared/webview/lib/statusStyles";
import { cn } from "../../../shared/webview/lib/utils";
import { NodeCapacityQueueList } from "./NodeCapacityQueue";
import type {
  OpenExternalHandler,
  OpenNodeDetailsHandler,
  RetryExecutorsHandler
} from "./NodeCapacityViewTypes";

const POOL_SEVERITY_BORDER_CLASSES: Record<NodeCapacitySeverity, string> = {
  critical: "border-failure-border",
  warning: "border-warning-border",
  normal: "border-border"
};

/**
 * Memoized so collapsed/untouched pools skip their whole subtree when the app
 * re-renders on clock ticks, unrelated pool toggles, or header-only updates;
 * pool/node view models keep stable identities between those renders.
 *
 * The header is a heading plus a disclosure button whose accessible name is
 * only the pool label and status. The button's `::after` covers the whole
 * header (see styles.css), so the counts and bar stay clickable without
 * becoming part of the button's name.
 */
export const NodeCapacityPoolPanel = React.memo(function NodeCapacityPoolPanel({
  pool,
  isOpen,
  onOpenExternal,
  onOpenNodeDetails,
  onRetryExecutors,
  onToggleExpanded
}: {
  pool: NodeCapacityPoolViewModel;
  isOpen: boolean;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onRetryExecutors: RetryExecutorsHandler;
  onToggleExpanded: (poolId: string, open: boolean) => void;
}): React.JSX.Element {
  const contentId = `capacity-pool-${React.useId()}`;
  const counts = buildPoolCounts(pool);

  return (
    <section
      className={cn(
        "capacity-pool group/pool rounded-lg border bg-card shadow-sm",
        POOL_SEVERITY_BORDER_CLASSES[pool.severity]
      )}
      data-open={isOpen || undefined}
    >
      {/* Bottom corners square off when open so the hover highlight meets the content edge. */}
      <div className="capacity-pool-header relative rounded-lg px-4 py-3 transition-colors hover:bg-accent-soft group-data-[open]/pool:rounded-b-none">
        <div className="grid gap-3 lg:grid-cols-6 lg:items-center">
          <div className="flex min-w-0 items-start gap-2 lg:col-span-2">
            <ChevronRightIcon
              aria-hidden="true"
              className="capacity-pool-chevron mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none"
            />
            <div className="min-w-0 flex-1">
              <h2 className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
                <button
                  type="button"
                  className="capacity-pool-toggle min-w-0 max-w-full cursor-pointer truncate text-left"
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  title={pool.label}
                  onClick={() => onToggleExpanded(pool.id, !isOpen)}
                >
                  {pool.label}
                  <span className="sr-only">, {pool.statusLabel}</span>
                </button>
                {/* Announced through the button name above. */}
                <span aria-hidden="true" className="inline-flex">
                  <ToneBadge
                    label={pool.statusLabel}
                    className={resolveSeverityBadgeClass(pool.severity)}
                  />
                </span>
              </h2>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {formatPoolAvailability(pool)}
              </div>
              <PoolInlineCounts counts={counts} />
              <ExecutorCapacityBar
                total={pool.totalExecutors}
                busy={pool.busyExecutors}
                idle={pool.idleExecutors}
              />
            </div>
          </div>
          <div className="hidden lg:contents">
            {counts.map((count) => (
              <PoolMetric key={count.label} count={count} />
            ))}
          </div>
        </div>
      </div>

      <div
        id={contentId}
        hidden={!isOpen}
        className="grid gap-4 border-t border-border p-4 lg:grid-cols-2"
      >
        {isOpen ? (
          <>
            <NodeList
              nodes={pool.nodes}
              onOpenNodeDetails={onOpenNodeDetails}
              onOpenExternal={onOpenExternal}
              onRetryExecutors={onRetryExecutors}
            />
            <NodeCapacityQueueList items={pool.queueItems} onOpenExternal={onOpenExternal} />
          </>
        ) : null}
      </div>
    </section>
  );
});

function formatPoolAvailability(pool: NodeCapacityPoolViewModel): string {
  const parts: string[] = [];
  if (pool.kind === "any") {
    parts.push("Unlabeled builds");
  }
  parts.push(`${pool.onlineNodes}/${pool.totalNodes} nodes online`);
  if (pool.offlineNodes > 0) {
    const nodes = `${pool.offlineNodes} offline node${pool.offlineNodes === 1 ? "" : "s"}`;
    parts.push(
      pool.offlineExecutors > 0
        ? `${pool.offlineExecutors} executor${pool.offlineExecutors === 1 ? "" : "s"} unavailable on ${nodes}`
        : nodes
    );
  }
  return parts.join(" · ");
}

type PoolCount = { label: string; value: number; tone?: "warning" | "failure" };

const POOL_COUNT_TONE_CLASSES: Record<NonNullable<PoolCount["tone"]>, string> = {
  warning: "text-warning-foreground",
  failure: "text-failure-foreground"
};

function buildPoolCounts(pool: NodeCapacityPoolViewModel): PoolCount[] {
  const starved = pool.queuedCount > 0 && pool.idleExecutors === 0;
  return [
    {
      label: "Queued",
      value: pool.queuedCount,
      tone:
        pool.stuckCount > 0 || starved ? "failure" : pool.queuedCount > 0 ? "warning" : undefined
    },
    { label: "Idle", value: pool.idleExecutors, tone: starved ? "failure" : undefined },
    { label: "Busy", value: pool.busyExecutors },
    {
      label: "Offline",
      value: pool.offlineExecutors,
      tone: pool.offlineExecutors > 0 ? "warning" : undefined
    }
  ];
}

/** Compact one-line counts used below the `lg` breakpoint instead of the tiles. */
function PoolInlineCounts({ counts }: { counts: PoolCount[] }): React.JSX.Element {
  return (
    <p className="mt-1 mb-0 text-xs text-muted-foreground lg:hidden">
      {counts.map((count, index) => (
        <React.Fragment key={count.label}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          <span className={cn(count.tone && POOL_COUNT_TONE_CLASSES[count.tone])}>
            <span className="font-semibold tabular-nums">{count.value}</span>{" "}
            {count.label.toLowerCase()}
          </span>
          {index < counts.length - 1 ? <span className="sr-only">,</span> : null}
        </React.Fragment>
      ))}
    </p>
  );
}

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
    <div className="mt-2 flex max-w-80 flex-wrap items-center gap-x-3 gap-y-1">
      <div
        role="img"
        aria-label={`Executors: ${description}`}
        title={description}
        className="flex h-1.5 w-full max-w-64 gap-px overflow-hidden rounded-full bg-muted"
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
      {/* The bar's accessible name already lists the counts; the legend is visual only. */}
      <ul
        aria-hidden="true"
        className="m-0 flex list-none gap-2.5 p-0 text-micro leading-none text-muted-foreground"
      >
        {CAPACITY_SEGMENTS.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1">
            <span
              className={cn("hc-outline inline-block h-1.5 w-2.5 rounded-full", segment.className)}
            />
            {segment.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PoolMetric({ count }: { count: PoolCount }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3 py-1.5">
      <div
        className={cn(
          "text-lg font-semibold tabular-nums leading-tight",
          count.tone && POOL_COUNT_TONE_CLASSES[count.tone]
        )}
      >
        {count.value}
      </div>
      <div className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {count.label}
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
  onOpenExternal,
  onRetryExecutors
}: {
  nodes: NodeCapacityNodeViewModel[];
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
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
        {nodes.map((node) => {
          const offlineTone = resolveNodeOfflineTone(node);
          return (
            <div
              key={node.nodeUrl ?? node.name}
              className={cn(
                "rounded-md border p-3",
                offlineTone
                  ? NODE_OFFLINE_ROW_CLASSES[offlineTone]
                  : "border-border bg-surface-sunken"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <NodeName node={node} onOpenNodeDetails={onOpenNodeDetails} />
                    {offlineTone ? (
                      <ToneBadge
                        label={node.statusLabel}
                        className={resolveNodeStatusBadgeClass(offlineTone)}
                      />
                    ) : (
                      <Badge variant="muted">{node.statusLabel}</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{node.executorSummary}</div>
                  {node.offlineReason ? (
                    <ClampedText
                      text={node.offlineReason}
                      className="mt-1"
                      textClassName="text-xs text-muted-foreground"
                    />
                  ) : null}
                  <NodeRunningWork
                    node={node}
                    onOpenExternal={onOpenExternal}
                    onRetryExecutors={onRetryExecutors}
                  />
                </div>
                {node.nodeUrl ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={`Open ${node.displayName} in Jenkins`}
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
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
          );
        })}
      </div>
    </section>
  );
});

type NodeOfflineTone = "offline" | "temporary";

/** Same tones as Node Details: disconnected is a fault, temporarily offline is intentional. */
const NODE_OFFLINE_ROW_CLASSES: Record<NodeOfflineTone, string> = {
  offline: "border-failure-border bg-failure-soft",
  temporary: "border-warning-border bg-warning-soft"
};

function resolveNodeOfflineTone(node: NodeCapacityNodeViewModel): NodeOfflineTone | undefined {
  if (!node.isOffline) {
    return undefined;
  }
  return node.isTemporarilyOffline ? "temporary" : "offline";
}

/** The node name doubles as the Node Details link, so each row keeps one icon action. */
function NodeName({
  node,
  onOpenNodeDetails
}: {
  node: NodeCapacityNodeViewModel;
  onOpenNodeDetails: OpenNodeDetailsHandler;
}): React.JSX.Element {
  const nodeUrl = node.nodeUrl;
  if (!nodeUrl) {
    return <TruncatedText text={node.displayName} className="text-sm font-medium" />;
  }
  return (
    <button
      type="button"
      className="focus-ring min-w-0 max-w-full truncate rounded-sm text-left text-sm font-medium text-link underline-offset-2 hover:text-link-hover hover:underline"
      title={`${node.displayName} (open node details)`}
      onClick={() => onOpenNodeDetails(nodeUrl, node.displayName)}
    >
      {node.displayName}
      <span className="sr-only">, open node details</span>
    </button>
  );
}

function NodeRunningWork({
  node,
  onOpenExternal,
  onRetryExecutors
}: {
  node: NodeCapacityNodeViewModel;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
}): React.JSX.Element | null {
  const hasLoadedBusyWork =
    node.executorsLoaded && node.executors.some((executor) => !executor.isIdle);
  // Offline nodes only list work when a draining build is still running.
  if (node.isOffline && !hasLoadedBusyWork) {
    return null;
  }
  const nodeUrl = node.nodeUrl;
  if (node.executorsLoadState === "error" && nodeUrl) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-failure-foreground">
        <span title={node.executorsError}>
          Couldn't load running work
          {node.executorsError ? <span className="sr-only">: {node.executorsError}</span> : null}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <button
          type="button"
          className="focus-ring rounded-sm text-link hover:text-link-hover hover:underline"
          aria-label={`Retry loading running work on ${node.displayName}`}
          onClick={() => onRetryExecutors(nodeUrl)}
        >
          Retry
        </button>
      </div>
    );
  }
  if (node.executorsLoaded) {
    return <ExecutorWorkList node={node} onOpenExternal={onOpenExternal} />;
  }
  if (node.executorsLoadState === "loading") {
    return <div className="mt-2 text-xs text-muted-foreground">Loading running work…</div>;
  }
  return null;
}

function ExecutorWorkList({
  node,
  onOpenExternal
}: {
  node: NodeCapacityNodeViewModel;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  const busyExecutors = node.executors.filter((executor) => !executor.isIdle);
  if (busyExecutors.length === 0) {
    return <div className="mt-2 text-xs text-muted-foreground">No builds running.</div>;
  }

  return (
    <ul className="mt-2 m-0 list-none space-y-0.5 border-l border-border p-0 pl-2.5">
      {busyExecutors.map((executor) => {
        const label = executor.workLabel ?? executor.statusLabel;
        const workUrl = executor.workUrl;
        return (
          <li key={executor.id} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="w-6 shrink-0 text-caption tabular-nums text-muted-foreground">
              {executor.id}
            </span>
            {workUrl ? (
              <button
                type="button"
                className="focus-ring group flex min-w-0 items-center gap-1 rounded-sm text-left text-link hover:text-link-hover hover:underline"
                aria-label={`Open ${label} in Jenkins (running on ${node.displayName})`}
                title={label}
                onClick={() => onOpenExternal(workUrl)}
              >
                <span className="truncate">{label}</span>
                <ExternalLinkIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ) : (
              <TruncatedText text={label} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

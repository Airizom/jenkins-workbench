import * as React from "react";
import type {
  NodeCapacityPoolViewModel,
  NodeCapacitySeverity
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { ToneBadge } from "../../../shared/webview/components/ToneBadge";
import { ChevronRightIcon } from "../../../shared/webview/icons";
import { resolveSeverityBadgeClass } from "../../../shared/webview/lib/statusStyles";
import { cn } from "../../../shared/webview/lib/utils";
import {
  CAPACITY_TONE_TEXT_CLASSES,
  filterPoolNodes,
  getVisiblePoolNodes,
  isNodeListCapped,
  orderPoolNodes,
  resolveIdleTone,
  resolveOfflineTone,
  resolveQueuedTone
} from "../state/nodeCapacityView";
import { ExecutorCapacityBar } from "./ExecutorCapacityBar";
import { NodeCapacityNodeList } from "./NodeCapacityNodeList";
import { NodeCapacityQueueList } from "./NodeCapacityQueue";
import type {
  OpenBuildDetailsHandler,
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
 * becoming part of the button's name. Nothing else in the header relies on
 * hover (no `title` tooltips), since the overlay would intercept it.
 */
export const NodeCapacityPoolPanel = React.memo(function NodeCapacityPoolPanel({
  pool,
  isOpen,
  showAllNodes,
  nodeQuery,
  onOpenExternal,
  onOpenNodeDetails,
  onOpenBuildDetails,
  onRetryExecutors,
  onToggleExpanded,
  onShowAllNodesChange
}: {
  pool: NodeCapacityPoolViewModel;
  isOpen: boolean;
  showAllNodes: boolean;
  nodeQuery: string;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onRetryExecutors: RetryExecutorsHandler;
  onToggleExpanded: (poolId: string, open: boolean) => void;
  onShowAllNodesChange: (poolId: string, showAll: boolean) => void;
}): React.JSX.Element {
  const contentId = `capacity-pool-${React.useId()}`;
  const matchingNodes = React.useMemo(() => filterPoolNodes(pool, nodeQuery), [pool, nodeQuery]);
  const orderedNodes = React.useMemo(() => orderPoolNodes(matchingNodes), [matchingNodes]);
  const visibleNodes = React.useMemo(
    () => getVisiblePoolNodes(orderedNodes, showAllNodes),
    [orderedNodes, showAllNodes]
  );
  const handleShowAllChange = React.useCallback(
    (showAll: boolean) => onShowAllNodesChange(pool.id, showAll),
    [onShowAllNodesChange, pool.id]
  );
  const hasQueue = pool.queueItems.length > 0;
  const nodeList = (
    <NodeCapacityNodeList
      nodes={visibleNodes}
      totalCount={orderedNodes.length}
      poolNodeCount={pool.nodes.length}
      capped={isNodeListCapped(orderedNodes.length, showAllNodes)}
      canCollapse={showAllNodes && isNodeListCapped(orderedNodes.length, false)}
      wide={!hasQueue}
      onShowAllChange={handleShowAllChange}
      onOpenNodeDetails={onOpenNodeDetails}
      onOpenBuildDetails={onOpenBuildDetails}
      onOpenExternal={onOpenExternal}
      onRetryExecutors={onRetryExecutors}
    />
  );

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
        <div className="flex items-start gap-2">
          <ChevronRightIcon
            aria-hidden="true"
            className="capacity-pool-chevron mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none"
          />
          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center">
            <div className="min-w-0">
              <h2 className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                {/* Labels can be long expressions; wrap instead of truncating so none is hidden. */}
                <button
                  type="button"
                  className="capacity-pool-toggle min-w-0 cursor-pointer text-left [overflow-wrap:anywhere]"
                  aria-expanded={isOpen}
                  aria-controls={contentId}
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
              <PoolQueueLine pool={pool} />
              <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                {formatPoolAvailability(pool)}
              </p>
            </div>
            <ExecutorCapacityBar
              counts={resolvePoolExecutorSegments(pool)}
              tones={{
                idle: resolveIdleTone(pool),
                offline: resolveOfflineTone(pool.offlineExecutors)
              }}
            />
          </div>
        </div>
      </div>

      <div id={contentId} hidden={!isOpen} className="border-t border-border p-4">
        {isOpen ? (
          hasQueue ? (
            // Queued work comes first: it is what a degraded pool is waiting on,
            // and it stays above the node list when the columns stack.
            <div className="grid gap-4 lg:grid-cols-2">
              <NodeCapacityQueueList
                items={pool.queueItems}
                pool={pool}
                onOpenExternal={onOpenExternal}
              />
              {nodeList}
            </div>
          ) : (
            nodeList
          )
        ) : null}
      </div>
    </section>
  );
});

/**
 * Pool `offlineExecutors` also counts builds still running on draining nodes
 * (already in `busy`), so the offline segment is whatever capacity remains.
 */
function resolvePoolExecutorSegments(pool: NodeCapacityPoolViewModel) {
  return {
    busy: pool.busyExecutors,
    idle: pool.idleExecutors,
    offline: Math.max(0, pool.totalExecutors - pool.busyExecutors - pool.idleExecutors)
  };
}

function PoolQueueLine({ pool }: { pool: NodeCapacityPoolViewModel }): React.JSX.Element {
  if (pool.queuedCount === 0) {
    return <p className="m-0 mt-1 text-xs text-muted-foreground">Nothing queued</p>;
  }
  const tone = resolveQueuedTone(pool);
  return (
    <p className={cn("m-0 mt-1 text-xs", tone ? CAPACITY_TONE_TEXT_CLASSES[tone] : undefined)}>
      <span className="font-semibold tabular-nums">{pool.queuedCount}</span> queued
      {pool.stuckCount > 0 ? (
        <>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          <span className="font-semibold tabular-nums">{pool.stuckCount}</span> stuck
        </>
      ) : null}
    </p>
  );
}

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

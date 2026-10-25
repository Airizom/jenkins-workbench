import * as React from "react";
import type {
  NodeCapacityExecutorViewModel,
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
  resolveNodeStatusStyle,
  resolveSeverityBadgeClass
} from "../../../shared/webview/lib/statusStyles";
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
    <NodeList
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

/**
 * Memoized so toggling a pool open/closed does not re-render every node row;
 * capacity data updates always replace the `nodes` array, so real changes
 * still re-render.
 */
const NodeList = React.memo(function NodeList({
  nodes,
  totalCount,
  poolNodeCount,
  capped,
  canCollapse,
  wide,
  onShowAllChange,
  onOpenNodeDetails,
  onOpenBuildDetails,
  onOpenExternal,
  onRetryExecutors
}: {
  nodes: readonly NodeCapacityNodeViewModel[];
  /** Nodes that pass the filter. */
  totalCount: number;
  /** Every node in the pool, to say when the filter narrowed the list. */
  poolNodeCount: number;
  /** More nodes exist than `nodes` shows. */
  capped: boolean;
  /** Every node shows and the list could be capped again. */
  canCollapse: boolean;
  /** Full width (no queue column), so rows flow into two columns. */
  wide: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
}): React.JSX.Element {
  if (totalCount === 0) {
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
        count={
          totalCount < poolNodeCount ? (
            // The heading is uppercase; keep "of" readable.
            <span className="normal-case">
              {totalCount} of {poolNodeCount}
            </span>
          ) : (
            totalCount
          )
        }
      />
      <div className={cn("gap-2", wide ? "grid lg:grid-cols-2" : "flex flex-col")}>
        {nodes.map((node) => (
          <NodeRow
            key={node.nodeUrl ?? node.name}
            node={node}
            onOpenNodeDetails={onOpenNodeDetails}
            onOpenBuildDetails={onOpenBuildDetails}
            onOpenExternal={onOpenExternal}
            onRetryExecutors={onRetryExecutors}
          />
        ))}
      </div>
      {capped || canCollapse ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => onShowAllChange(capped)}>
          {capped ? `Show all ${totalCount} nodes` : "Show fewer nodes"}
        </Button>
      ) : null}
    </section>
  );
});

type NodeOfflineTone = "offline" | "temporary";

/**
 * Same tones as Node Details: disconnected is a fault, temporarily offline is
 * intentional. A left accent plus the status badge marks the row; a full tint
 * would stack a third red/yellow layer inside an already-toned pool.
 */
const NODE_OFFLINE_ACCENT_CLASSES: Record<NodeOfflineTone, string> = {
  offline: "border-l-failure",
  temporary: "border-l-warning"
};

function resolveNodeOfflineTone(node: NodeCapacityNodeViewModel): NodeOfflineTone | undefined {
  if (!node.isOffline) {
    return undefined;
  }
  return node.isTemporarilyOffline ? "temporary" : "offline";
}

function NodeRow({
  node,
  onOpenNodeDetails,
  onOpenBuildDetails,
  onOpenExternal,
  onRetryExecutors
}: {
  node: NodeCapacityNodeViewModel;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
}): React.JSX.Element {
  const offlineTone = resolveNodeOfflineTone(node);
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-border bg-surface-sunken p-3",
        offlineTone && cn("border-l-2", NODE_OFFLINE_ACCENT_CLASSES[offlineTone])
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <NodeName node={node} onOpenNodeDetails={onOpenNodeDetails} />
            {offlineTone ? (
              <ToneBadge
                label={node.statusLabel}
                className={resolveNodeStatusStyle(offlineTone).badge}
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
            onOpenBuildDetails={onOpenBuildDetails}
            onOpenExternal={onOpenExternal}
            onRetryExecutors={onRetryExecutors}
          />
        </div>
        {node.nodeUrl ? (
          <OpenInJenkinsButton
            label={`Open ${node.displayName} in Jenkins`}
            onClick={() => node.nodeUrl && onOpenExternal(node.nodeUrl)}
          />
        ) : null}
      </div>
    </div>
  );
}

function OpenInJenkinsButton({
  label,
  size = "icon",
  onClick
}: {
  label: string;
  size?: "icon" | "icon-sm";
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          variant="ghost"
          size={size}
          className={cn(
            "shrink-0 text-muted-foreground hover:text-foreground",
            size === "icon-sm" && "h-5 w-5"
          )}
          onClick={onClick}
        >
          <ExternalLinkIcon className={size === "icon" ? "h-4 w-4" : "h-3 w-3"} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Open in Jenkins</TooltipContent>
    </Tooltip>
  );
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
  onOpenBuildDetails,
  onOpenExternal,
  onRetryExecutors
}: {
  node: NodeCapacityNodeViewModel;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
}): React.JSX.Element | null {
  const hasLoadedBusyWork =
    node.executorsLoaded && node.executors.some((executor) => !executor.isIdle);
  // Offline nodes only list work while a draining build is still running; keep
  // request status visible while that work is loading, failed, or stale.
  if (node.isOffline && !hasLoadedBusyWork && node.busyExecutors === 0) {
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
    return (
      <ExecutorWorkList
        node={node}
        onOpenBuildDetails={onOpenBuildDetails}
        onOpenExternal={onOpenExternal}
      />
    );
  }
  if (node.executorsLoadState === "loading") {
    return <div className="mt-2 text-xs text-muted-foreground">Loading running work…</div>;
  }
  return null;
}

/** Jenkins build URLs end in the build number, e.g. `/job/api/job/main/7/`. */
const BUILD_URL_PATTERN = /\/\d+\/?$/;

function ExecutorWorkList({
  node,
  onOpenBuildDetails,
  onOpenExternal
}: {
  node: NodeCapacityNodeViewModel;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  const busyExecutors = node.executors.filter((executor) => !executor.isIdle);
  if (busyExecutors.length === 0) {
    return <div className="mt-2 text-xs text-muted-foreground">No builds running.</div>;
  }

  return (
    <ul className="mt-2 m-0 list-none space-y-0.5 border-l border-border p-0 pl-2.5">
      {busyExecutors.map((executor) => (
        <li key={executor.id} className="flex min-w-0 items-center gap-2 text-xs">
          <span className="w-6 shrink-0 text-caption tabular-nums text-muted-foreground">
            {executor.id}
          </span>
          <ExecutorWork
            executor={executor}
            nodeName={node.displayName}
            onOpenBuildDetails={onOpenBuildDetails}
            onOpenExternal={onOpenExternal}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Same pattern as a node row: the name opens the in-editor details panel and
 * a separate icon opens Jenkins. Work that is not a build URL only opens Jenkins.
 */
function ExecutorWork({
  executor,
  nodeName,
  onOpenBuildDetails,
  onOpenExternal
}: {
  executor: NodeCapacityExecutorViewModel;
  nodeName: string;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  const label = executor.workLabel ?? executor.statusLabel;
  const workUrl = executor.workUrl;
  if (!workUrl) {
    return <TruncatedText text={label} />;
  }
  const linkClassName =
    "focus-ring min-w-0 truncate rounded-sm text-left text-link underline-offset-2 hover:text-link-hover hover:underline";
  if (!BUILD_URL_PATTERN.test(workUrl)) {
    return (
      <button
        type="button"
        className={linkClassName}
        aria-label={`Open ${label} in Jenkins (running on ${nodeName})`}
        title={label}
        onClick={() => onOpenExternal(workUrl)}
      >
        {label}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className={linkClassName}
        title={`${label} (open build details)`}
        onClick={() => onOpenBuildDetails(workUrl, label)}
      >
        {label}
        <span className="sr-only">, running on {nodeName}, open build details</span>
      </button>
      <OpenInJenkinsButton
        label={`Open ${label} in Jenkins`}
        size="icon-sm"
        onClick={() => onOpenExternal(workUrl)}
      />
    </>
  );
}

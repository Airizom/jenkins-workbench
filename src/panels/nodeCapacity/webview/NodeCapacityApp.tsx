import * as React from "react";
import { formatRelativeIsoTimestamp } from "../../../formatters/RelativeTimeFormatters";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacitySeverity
} from "../../../shared/nodeCapacity/NodeCapacityContracts";
import type { QueueWorkItemViewModel } from "../../../shared/queueWork/QueueWorkContracts";
import { EmptyState } from "../../shared/webview/components/EmptyState";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { PanelHeader } from "../../shared/webview/components/PanelHeader";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
import { QueueWorkItemRow } from "../../shared/webview/components/queueWork/QueueWorkItemRow";
import { SectionHeading } from "../../shared/webview/components/SectionHeading";
import { SeverityBadge } from "../../shared/webview/components/SeverityBadge";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "../../shared/webview/components/ui/tooltip";
import { useOpenExternalMessage } from "../../shared/webview/hooks/useOpenExternalMessage";
import { usePanelPostMessage } from "../../shared/webview/hooks/usePanelPostMessage";
import { toast } from "../../shared/webview/hooks/useToast";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ClockIcon,
  ExternalLinkIcon,
  RefreshIcon,
  ServerIcon
} from "../../shared/webview/icons";
import { cn } from "../../shared/webview/lib/utils";
import type {
  NodeCapacityIncomingMessage,
  OpenNodeDetailsMessage
} from "../shared/NodeCapacityPanelMessages";
import { useNodeCapacityMessages } from "./hooks/useNodeCapacityMessages";
import {
  getInitialState,
  isStaleCapacityTimestamp,
  NODE_CAPACITY_REFRESH_INTERVAL_MS,
  type NodeCapacityState,
  nodeCapacityReducer
} from "./state/nodeCapacityState";

const { useCallback, useEffect, useMemo, useReducer, useRef, useState } = React;

type OpenExternalHandler = (url: string) => void;
type OpenNodeDetailsHandler = (nodeUrl: string, label?: string) => void;

const POOL_SEVERITY_BORDER_CLASSES: Record<NodeCapacitySeverity, string> = {
  critical: "border-failure-border",
  warning: "border-warning-border",
  normal: "border-border"
};

function postLoadExecutors(
  postMessage: (message: NodeCapacityIncomingMessage) => void,
  nodeUrls: string[]
): void {
  if (nodeUrls.length === 0) {
    return;
  }
  postMessage({
    type: "loadNodeCapacityExecutors",
    nodeUrls: [...new Set(nodeUrls)]
  });
}

export function createExecutorLoadRequestKey(updatedAt: string, nodeUrls: string[]): string {
  return JSON.stringify([updatedAt, [...new Set(nodeUrls)].sort()]);
}

export function postLoadExecutorsIfChanged(
  postMessage: (message: NodeCapacityIncomingMessage) => void,
  lastRequestKey: { current: string | undefined },
  updatedAt: string,
  nodeUrls: string[]
): void {
  const requestKey = createExecutorLoadRequestKey(updatedAt, nodeUrls);
  if (lastRequestKey.current === requestKey) {
    return;
  }
  lastRequestKey.current = requestKey;
  postLoadExecutors(postMessage, nodeUrls);
}

export function NodeCapacityApp(): React.JSX.Element {
  const [state, dispatch] = useReducer(nodeCapacityReducer, undefined, getInitialState);
  const postMessage = usePanelPostMessage<NodeCapacityIncomingMessage>();
  const handleOpenExternal = useOpenExternalMessage(postMessage);
  useNodeCapacityMessages(dispatch);

  const [now, setNow] = useState(() => Date.now());
  const updatedAtLabel = useMemo(
    () => formatRelativeIsoTimestamp(state.updatedAt),
    [state.updatedAt, now]
  );
  const isStale = useMemo(
    () => state.hasLoaded && isStaleCapacityTimestamp(state.updatedAt, now),
    [state.hasLoaded, state.updatedAt, now]
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, NODE_CAPACITY_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  const previousErrorCount = useRef(0);
  useEffect(() => {
    if (state.hasLoaded && state.errors.length > 0 && previousErrorCount.current === 0) {
      toast({
        title: "Refresh failed",
        description: state.errors[0],
        variant: "destructive"
      });
    }
    previousErrorCount.current = state.errors.length;
  }, [state.hasLoaded, state.errors]);
  const [poolOpenStates, setPoolOpenStates] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  );
  const handlePoolToggle = useCallback((poolId: string, open: boolean) => {
    setPoolOpenStates((current) => {
      if (current.get(poolId) === open) {
        return current;
      }
      const next = new Map(current);
      next.set(poolId, open);
      return next;
    });
  }, []);

  const expandedNodeUrls = useMemo(
    () =>
      state.pools
        .filter((pool) => poolOpenStates.get(pool.id) ?? pool.severity !== "normal")
        .flatMap((pool) => pool.nodes)
        .map((node) => node.nodeUrl)
        .filter((nodeUrl): nodeUrl is string => Boolean(nodeUrl)),
    [state.pools, poolOpenStates]
  );

  const lastExecutorLoadRequestKey = useRef<string>(undefined);
  useEffect(() => {
    postLoadExecutorsIfChanged(
      postMessage,
      lastExecutorLoadRequestKey,
      state.updatedAt,
      expandedNodeUrls
    );
  }, [expandedNodeUrls, postMessage, state.updatedAt]);

  if (state.loading && !state.hasLoaded) {
    return (
      <PanelInitialLoadingGate loading={state.loading} hasLoaded={state.hasLoaded} variant="node" />
    );
  }

  const handleRefresh = () => {
    postMessage({ type: "refreshNodeCapacity" });
  };

  const handleOpenNodeDetails = (nodeUrl: string, label?: string) => {
    const message: OpenNodeDetailsMessage = { type: "openNodeDetails", nodeUrl, label };
    postMessage(message);
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        {state.loading ? (
          <div className="fixed inset-x-0 top-0 z-50">
            <Progress indeterminate className="h-px rounded-none" />
          </div>
        ) : null}
        <PanelHeader
          eyebrow={state.environmentLabel}
          eyebrowIcon={<ServerIcon className="h-3.5 w-3.5" />}
          title="Node Capacity"
          titleAdornment={
            isStale ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="warning" size="sm">
                    <AlertTriangleIcon className="h-3 w-3" aria-hidden="true" />
                    Stale
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  This snapshot is older than the refresh interval. Refresh for current capacity.
                </TooltipContent>
              </Tooltip>
            ) : null
          }
          meta={<span className="hidden sm:inline">Updated {updatedAtLabel}</span>}
          actions={
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={state.loading}>
              <RefreshIcon className={cn("h-3.5 w-3.5", state.loading && "animate-spin")} />
              Refresh
            </Button>
          }
        />

        <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4" aria-busy={state.loading}>
          <PanelErrorList
            errors={state.errors}
            title="Node capacity errors"
            onRetry={handleRefresh}
          />

          <SummaryStrip state={state} />

          {state.hiddenLabelQueueItems.length > 0 ? (
            <HiddenLabelQueue
              items={state.hiddenLabelQueueItems}
              onOpenExternal={handleOpenExternal}
            />
          ) : null}

          <section className="space-y-3">
            {state.pools.length === 0 ? (
              <EmptyState
                icon={<ServerIcon className="h-4 w-4" />}
                title="No node capacity data"
                description="Jenkins returned no label pools for this environment. Refresh once agents are connected."
                action={
                  <Button variant="outline" size="sm" onClick={handleRefresh}>
                    <RefreshIcon className="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                }
              />
            ) : (
              state.pools.map((pool) => (
                <PoolPanel
                  key={pool.id}
                  pool={pool}
                  isOpen={poolOpenStates.get(pool.id) ?? pool.severity !== "normal"}
                  onOpenExternal={handleOpenExternal}
                  onOpenNodeDetails={handleOpenNodeDetails}
                  onToggleExpanded={handlePoolToggle}
                />
              ))
            )}
          </section>
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}

function SummaryStrip({ state }: { state: NodeCapacityState }): React.JSX.Element {
  // Status tones apply only when a metric signals a problem; zero counts stay
  // neutral so a healthy dashboard reads calm. Each tone is paired with the
  // metric label text, so color is never the only cue.
  const metrics = [
    { label: "Queued", value: state.summary.queuedCount, tone: "text-foreground" },
    {
      label: "Stuck",
      value: state.summary.stuckCount,
      tone: state.summary.stuckCount > 0 ? "text-failure" : "text-foreground"
    },
    { label: "Idle executors", value: state.summary.idleExecutors, tone: "text-foreground" },
    { label: "Busy executors", value: state.summary.busyExecutors, tone: "text-foreground" },
    {
      label: "Offline executors",
      value: state.summary.offlineExecutors,
      tone: state.summary.offlineExecutors > 0 ? "text-warning" : "text-foreground"
    },
    {
      label: "Bottlenecks",
      value: state.summary.bottleneckCount,
      tone: state.summary.bottleneckCount > 0 ? "text-failure" : "text-foreground"
    }
  ];

  return (
    <section aria-label="Capacity summary" className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs"
        >
          <div className={cn("text-2xl font-semibold tabular-nums leading-tight", metric.tone)}>
            {metric.value}
          </div>
          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {metric.label}
          </div>
        </div>
      ))}
    </section>
  );
}

function PoolPanel({
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
    onToggleExpanded(pool.id, event.currentTarget.open);
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
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(90px,0.55fr))] lg:items-center">
          <div className="flex min-w-0 items-start gap-2">
            <ChevronDownIcon
              aria-hidden="true"
              className="capacity-pool-chevron mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{pool.label}</h2>
                <SeverityBadge severity={pool.severity} label={pool.statusLabel} />
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

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <NodeList
          nodes={pool.nodes}
          onOpenNodeDetails={onOpenNodeDetails}
          onOpenExternal={onOpenExternal}
        />
        <QueueList items={pool.queueItems} onOpenExternal={onOpenExternal} />
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

function NodeList({
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
              <div className="min-w-0">
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
                {node.executorsLoaded ? (
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
}

function QueueList({
  items,
  onOpenExternal
}: {
  items: QueueWorkItemViewModel[];
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <section>
      <SectionHeading
        title="Queued work"
        icon={<ClockIcon className="h-3.5 w-3.5" />}
        count={items.length > 0 ? items.length : undefined}
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing queued"
          description="No queued builds are waiting on this pool."
          className="py-6"
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <QueueRow key={item.id} item={item} onOpenExternal={onOpenExternal} />
          ))}
        </div>
      )}
    </section>
  );
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
    return <div className="mt-2 text-xs text-muted-foreground">No running work loaded.</div>;
  }

  return (
    <div className="mt-2 space-y-1">
      {busyExecutors.map((executor) => (
        <div
          key={executor.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-2 py-1"
        >
          <div className="min-w-0">
            <span className="text-[11px] text-muted-foreground">{executor.id}</span>
            <span className="ml-2 truncate text-xs">
              {executor.workLabel ?? executor.statusLabel}
            </span>
          </div>
          {executor.workUrl ? (
            <Button
              aria-label={`Open running work on ${node.displayName}`}
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => executor.workUrl && onOpenExternal(executor.workUrl)}
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function QueueRow({
  item,
  onOpenExternal
}: {
  item: QueueWorkItemViewModel;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-sunken p-3">
      <QueueWorkItemRow item={item} onOpenExternal={onOpenExternal} action="external-icon" />
    </div>
  );
}

function HiddenLabelQueue({
  items,
  onOpenExternal
}: {
  items: QueueWorkItemViewModel[];
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-warning-border bg-warning-soft p-4 shadow-xs">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">Node-specific label pressure</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These queue items target labels hidden from the shared pool list.
            </p>
          </div>
        </div>
        <Badge variant="warning" size="sm">
          {items.length}
        </Badge>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => (
          <QueueRow key={item.id} item={item} onOpenExternal={onOpenExternal} />
        ))}
      </div>
    </section>
  );
}

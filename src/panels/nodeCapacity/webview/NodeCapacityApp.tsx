import * as React from "react";
import { formatRelativeIsoTimestamp } from "../../../formatters/RelativeTimeFormatters";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel
} from "../../../shared/nodeCapacity/NodeCapacityContracts";
import type { QueueWorkItemViewModel } from "../../../shared/queueWork/QueueWorkContracts";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
import { SeverityBadge } from "../../shared/webview/components/SeverityBadge";
import { QueueWorkItemRow } from "../../shared/webview/components/queueWork/QueueWorkItemRow";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { useOpenExternalMessage } from "../../shared/webview/hooks/useOpenExternalMessage";
import { usePanelPostMessage } from "../../shared/webview/hooks/usePanelPostMessage";
import { toast } from "../../shared/webview/hooks/useToast";
import { ExternalLinkIcon, RefreshIcon, ServerIcon } from "../../shared/webview/icons";
import type {
  LoadNodeCapacityExecutorsMessage,
  NodeCapacityIncomingMessage,
  OpenNodeDetailsMessage
} from "../shared/NodeCapacityPanelMessages";
import { useNodeCapacityMessages } from "./hooks/useNodeCapacityMessages";
import {
  NODE_CAPACITY_REFRESH_INTERVAL_MS,
  type NodeCapacityState,
  getInitialState,
  isStaleCapacityTimestamp,
  nodeCapacityReducer
} from "./state/nodeCapacityState";

const { useCallback, useEffect, useMemo, useReducer, useRef, useState } = React;

function postLoadExecutors(
  postMessage: (message: NodeCapacityIncomingMessage) => void,
  nodeUrls: string[]
): void {
  if (nodeUrls.length === 0) {
    return;
  }
  const uniqueNodeUrls = [...new Set(nodeUrls)];
  const message: LoadNodeCapacityExecutorsMessage = {
    type: "loadNodeCapacityExecutors",
    nodeUrls: uniqueNodeUrls
  };
  postMessage(message);
}
export function NodeCapacityApp(): JSX.Element {
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
    [state.pools, poolOpenStates, state.updatedAt]
  );

  React.useEffect(() => {
    postLoadExecutors(postMessage, expandedNodeUrls);
  }, [expandedNodeUrls, postMessage]);

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
        <header className="sticky top-0 z-10 border-b border-border bg-header/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
                <ServerIcon className="h-4 w-4" />
                <span className="truncate">{state.environmentLabel}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold">Node Capacity</h1>
                {isStale ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-warning-border text-warning bg-warning-soft"
                  >
                    Stale
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Updated {updatedAtLabel}</span>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={state.loading}>
                <RefreshIcon className={state.loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                Refresh
              </Button>
            </div>
          </div>
        </header>

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
              <div className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
                No node capacity data is available.
              </div>
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

function SummaryStrip({ state }: { state: NodeCapacityState }): JSX.Element {
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
    <section className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-md border border-border bg-card px-3 py-3">
          <div className={`text-2xl font-semibold ${metric.tone}`}>{metric.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{metric.label}</div>
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
  onOpenExternal: (url: string) => void;
  onOpenNodeDetails: (nodeUrl: string, label?: string) => void;
  onToggleExpanded: (poolId: string, open: boolean) => void;
}): JSX.Element {
  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    onToggleExpanded(pool.id, event.currentTarget.open);
  };

  return (
    <details
      className="capacity-pool rounded-md border border-border bg-card"
      open={isOpen}
      onToggle={handleToggle}
    >
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(90px,0.55fr))] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{pool.label}</h2>
              <SeverityBadge severity={pool.severity} label={pool.statusLabel} />
              {pool.kind === "any" ? <Badge variant="outline">unassigned</Badge> : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {pool.onlineNodes}/{pool.totalNodes} nodes online
              {pool.offlineExecutors > 0 ? ` - ${pool.offlineExecutors} offline executors` : ""}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:contents">
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
        <QueueList
          title="Queued work"
          items={pool.queueItems}
          emptyLabel="No queued builds are assigned to this pool."
          onOpenExternal={onOpenExternal}
        />
        {pool.offlineImpact.length > 0 ? (
          <div className="lg:col-span-2">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Offline capacity impact
            </h3>
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

function PoolMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function NodeList({
  nodes,
  onOpenNodeDetails,
  onOpenExternal
}: {
  nodes: NodeCapacityNodeViewModel[];
  onOpenNodeDetails: (nodeUrl: string, label?: string) => void;
  onOpenExternal: (url: string) => void;
}): JSX.Element {
  if (nodes.length === 0) {
    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Nodes</h3>
        <div className="rounded-md border border-failure-border bg-failure-soft p-3 text-sm">
          No known nodes provide this label.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Nodes</h3>
      <div className="space-y-2">
        {nodes.map((node) => (
          <div
            key={node.nodeUrl ?? node.name}
            className={
              node.isOffline
                ? "rounded-md border border-warning-border bg-warning-soft p-3"
                : "rounded-md border border-border bg-background p-3"
            }
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
              <div className="flex shrink-0 gap-1">
                {node.nodeUrl ? (
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
                ) : null}
                {node.nodeUrl ? (
                  <Button
                    aria-label={`Open ${node.displayName} in Jenkins`}
                    variant="ghost"
                    size="icon"
                    onClick={() => node.nodeUrl && onOpenExternal(node.nodeUrl)}
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                  </Button>
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
  title,
  items,
  emptyLabel,
  onOpenExternal
}: {
  title: string;
  items: QueueWorkItemViewModel[];
  emptyLabel: string;
  onOpenExternal: (url: string) => void;
}): JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <div className="rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
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
  onOpenExternal: (url: string) => void;
}): JSX.Element | null {
  const busyExecutors = node.executors.filter((executor) => !executor.isIdle);
  if (busyExecutors.length === 0) {
    return <div className="mt-2 text-xs text-muted-foreground">No running work loaded.</div>;
  }

  return (
    <div className="mt-2 space-y-1">
      {busyExecutors.map((executor) => (
        <div
          key={executor.id}
          className="flex items-center justify-between gap-2 rounded border border-border bg-muted-soft px-2 py-1"
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
  onOpenExternal: (url: string) => void;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <QueueWorkItemRow item={item} onOpenExternal={onOpenExternal} action="external-icon" />
    </div>
  );
}

function HiddenLabelQueue({
  items,
  onOpenExternal
}: {
  items: QueueWorkItemViewModel[];
  onOpenExternal: (url: string) => void;
}): JSX.Element {
  return (
    <section className="rounded-md border border-warning-border bg-warning-soft p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Node-specific label pressure</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These queue items target labels hidden from the shared pool list.
          </p>
        </div>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => (
          <QueueRow key={item.id} item={item} onOpenExternal={onOpenExternal} />
        ))}
      </div>
    </section>
  );
}

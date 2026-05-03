import * as React from "react";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacitySeverity
} from "../../../shared/nodeCapacity/NodeCapacityContracts";
import type { QueueWorkItemViewModel } from "../../../shared/queueWork/QueueWorkContracts";
import { Alert } from "../../shared/webview/components/ui/alert";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import { LoadingSkeleton } from "../../shared/webview/components/ui/loading-skeleton";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { ExternalLinkIcon, RefreshIcon, ServerIcon } from "../../shared/webview/icons";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import type {
  LoadNodeCapacityExecutorsMessage,
  NodeCapacityIncomingMessage,
  OpenExternalMessage,
  OpenNodeDetailsMessage
} from "../shared/NodeCapacityPanelMessages";
import { useNodeCapacityMessages } from "./hooks/useNodeCapacityMessages";
import {
  type NodeCapacityState,
  getInitialState,
  nodeCapacityReducer
} from "./state/nodeCapacityState";

const { useMemo, useReducer } = React;

const SEVERITY_BADGE: Record<NodeCapacitySeverity, string> = {
  critical: "border-failure-border bg-failure-soft text-failure-foreground",
  warning: "border-warning-border bg-warning-soft text-warning-foreground",
  normal: "border-success-border bg-success-soft text-success-foreground"
};

function postNodeCapacityMessage(message: NodeCapacityIncomingMessage): void {
  postVsCodeMessage(message);
}

function postLoadExecutors(nodeUrls: string[]): void {
  if (nodeUrls.length === 0) {
    return;
  }
  const uniqueNodeUrls = [...new Set(nodeUrls)];
  const message: LoadNodeCapacityExecutorsMessage = {
    type: "loadNodeCapacityExecutors",
    nodeUrls: uniqueNodeUrls
  };
  postNodeCapacityMessage(message);
}

export function NodeCapacityApp(): JSX.Element {
  const [state, dispatch] = useReducer(nodeCapacityReducer, undefined, getInitialState);
  useNodeCapacityMessages(dispatch);

  const updatedAtLabel = useMemo(() => formatUpdatedAt(state.updatedAt), [state.updatedAt]);
  const initiallyOpenNodeUrls = useMemo(
    () => getUnloadedNodeUrls(state.pools.filter((pool) => pool.severity !== "normal")),
    [state.pools]
  );

  React.useEffect(() => {
    postLoadExecutors(initiallyOpenNodeUrls);
  }, [initiallyOpenNodeUrls]);

  if (state.loading && !state.hasLoaded) {
    return <LoadingSkeleton variant="node" />;
  }

  const handleRefresh = () => {
    postNodeCapacityMessage({ type: "refreshNodeCapacity" });
  };

  const handleOpenExternal = (url: string) => {
    const message: OpenExternalMessage = { type: "openExternal", url };
    postNodeCapacityMessage(message);
  };

  const handleOpenNodeDetails = (nodeUrl: string, label?: string) => {
    const message: OpenNodeDetailsMessage = { type: "openNodeDetails", nodeUrl, label };
    postNodeCapacityMessage(message);
  };

  const handleLoadExecutors = (nodeUrls: string[]) => {
    postLoadExecutors(nodeUrls);
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-10 border-b border-border bg-header/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
                <ServerIcon className="h-4 w-4" />
                <span className="truncate">{state.environmentLabel}</span>
              </div>
              <h1 className="mt-1 text-lg font-semibold">Node Capacity</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Updated {updatedAtLabel}
              </span>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={state.loading}>
                <RefreshIcon className={state.loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4" aria-busy={state.loading}>
          {state.errors.map((error) => (
            <Alert key={error} variant="destructive">
              {error}
            </Alert>
          ))}

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
                  onOpenExternal={handleOpenExternal}
                  onOpenNodeDetails={handleOpenNodeDetails}
                  onLoadExecutors={handleLoadExecutors}
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

function getUnloadedNodeUrls(pools: NodeCapacityPoolViewModel[]): string[] {
  return pools
    .flatMap((pool) => pool.nodes)
    .filter((node) => node.nodeUrl && !node.executorsLoaded)
    .map((node) => node.nodeUrl as string);
}

function SummaryStrip({ state }: { state: NodeCapacityState }): JSX.Element {
  const metrics = [
    { label: "Queued", value: state.summary.queuedCount, tone: "text-foreground" },
    { label: "Stuck", value: state.summary.stuckCount, tone: "text-failure-foreground" },
    {
      label: "Idle executors",
      value: state.summary.idleExecutors,
      tone: "text-success-foreground"
    },
    { label: "Busy executors", value: state.summary.busyExecutors, tone: "text-foreground" },
    {
      label: "Offline executors",
      value: state.summary.offlineExecutors,
      tone: "text-warning-foreground"
    },
    { label: "Bottlenecks", value: state.summary.bottleneckCount, tone: "text-failure-foreground" }
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
  onOpenExternal,
  onOpenNodeDetails,
  onLoadExecutors
}: {
  pool: NodeCapacityPoolViewModel;
  onOpenExternal: (url: string) => void;
  onOpenNodeDetails: (nodeUrl: string, label?: string) => void;
  onLoadExecutors: (nodeUrls: string[]) => void;
}): JSX.Element {
  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) {
      return;
    }
    onLoadExecutors(getUnloadedNodeUrls([pool]));
  };

  return (
    <details
      className="capacity-pool rounded-md border border-border bg-card"
      open={pool.severity !== "normal"}
      onToggle={handleToggle}
    >
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(90px,0.55fr))] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{pool.label}</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] ${SEVERITY_BADGE[pool.severity]}`}
              >
                {pool.statusLabel}
              </span>
              {pool.kind === "any" ? <Badge variant="outline">unassigned</Badge> : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {pool.onlineNodes}/{pool.totalNodes} nodes online
              {pool.offlineExecutors > 0 ? ` - ${pool.offlineExecutors} offline executors` : ""}
            </div>
          </div>
          <PoolMetric label="Queued" value={pool.queuedCount} />
          <PoolMetric label="Idle" value={pool.idleExecutors} />
          <PoolMetric label="Busy" value={pool.busyExecutors} />
          <PoolMetric label="Offline" value={pool.offlineExecutors} />
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
    <div className="rounded border border-border bg-muted-soft px-3 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
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
            className="rounded-md border border-border bg-background p-3"
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{item.name}</span>
            <Badge variant={item.stuck || item.blocked ? "secondary" : "muted"}>
              {item.statusLabel}
            </Badge>
            {item.queuedForLabels.length > 0 ? (
              <Badge variant="outline">{item.queuedForLabels.join(", ")}</Badge>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            #{item.position} in queue
            {item.queuedDurationLabel ? ` - ${item.queuedDurationLabel}` : ""}
          </div>
          {item.reason ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
          ) : null}
        </div>
        {item.taskUrl ? (
          <Button
            aria-label={`Open ${item.name} in Jenkins`}
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => item.taskUrl && onOpenExternal(item.taskUrl)}
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
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

function formatUpdatedAt(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "unknown";
  }
  const ageMs = Math.max(0, Date.now() - parsed);
  if (ageMs < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return new Date(parsed).toLocaleTimeString();
}

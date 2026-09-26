import * as React from "react";
import { formatRelativeIsoTimestamp } from "../../../formatters/RelativeTimeFormatters";
import { EmptyState } from "../../shared/webview/components/EmptyState";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { PanelHeader } from "../../shared/webview/components/PanelHeader";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
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
import { AlertTriangleIcon, RefreshIcon, ServerIcon } from "../../shared/webview/icons";
import { cn } from "../../shared/webview/lib/utils";
import type {
  NodeCapacityIncomingMessage,
  OpenNodeDetailsMessage
} from "../shared/NodeCapacityPanelMessages";
import { NodeCapacityPoolPanel } from "./components/NodeCapacityPoolPanel";
import { HiddenLabelQueue } from "./components/NodeCapacityQueue";
import { NodeCapacitySummary } from "./components/NodeCapacitySummary";
import { useNodeCapacityMessages } from "./hooks/useNodeCapacityMessages";
import {
  getInitialState,
  isStaleCapacityTimestamp,
  NODE_CAPACITY_REFRESH_INTERVAL_MS,
  nodeCapacityReducer
} from "./state/nodeCapacityState";

const { useCallback, useEffect, useMemo, useReducer, useRef, useState } = React;

export function postLoadExecutorsIfChanged(
  postMessage: (message: NodeCapacityIncomingMessage) => void,
  lastRequestKey: { current: string | undefined },
  updatedAt: string,
  snapshotGeneration: number,
  nodeUrls: string[]
): void {
  const normalizedNodeUrls = [...new Set(nodeUrls)].sort();
  const requestKey = JSON.stringify([updatedAt, snapshotGeneration, normalizedNodeUrls]);
  if (lastRequestKey.current === requestKey) {
    return;
  }
  lastRequestKey.current = requestKey;
  if (normalizedNodeUrls.length > 0) {
    postMessage({
      type: "loadNodeCapacityExecutors",
      snapshotGeneration,
      nodeUrls: normalizedNodeUrls
    });
  }
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
      state.snapshotGeneration,
      expandedNodeUrls
    );
  }, [expandedNodeUrls, postMessage, state.updatedAt, state.snapshotGeneration]);

  const handleOpenNodeDetails = useCallback(
    (nodeUrl: string, label?: string) => {
      const message: OpenNodeDetailsMessage = { type: "openNodeDetails", nodeUrl, label };
      postMessage(message);
    },
    [postMessage]
  );

  if (state.loading && !state.hasLoaded) {
    return (
      <PanelInitialLoadingGate loading={state.loading} hasLoaded={state.hasLoaded} variant="node" />
    );
  }

  const handleRefresh = () => {
    postMessage({ type: "refreshNodeCapacity" });
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
          <NodeCapacitySummary state={state} />
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
                <NodeCapacityPoolPanel
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

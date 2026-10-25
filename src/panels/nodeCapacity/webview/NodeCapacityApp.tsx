import * as React from "react";
import type { NodeCapacityPoolViewModel } from "../../../shared/nodeCapacity/NodeCapacityContracts";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
import { Progress } from "../../shared/webview/components/ui/progress";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { useOpenExternalMessage } from "../../shared/webview/hooks/useOpenExternalMessage";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import type {
  NodeCapacityIncomingMessage,
  OpenBuildDetailsMessage,
  OpenNodeDetailsMessage
} from "../shared/NodeCapacityPanelMessages";
import { NodeCapacityHeader } from "./components/NodeCapacityHeader";
import { NodeCapacityPoolList } from "./components/NodeCapacityPoolList";
import { NodeCapacityPoolToolbar } from "./components/NodeCapacityPoolToolbar";
import { PinnedNodeQueue } from "./components/NodeCapacityQueue";
import { NodeCapacitySummary } from "./components/NodeCapacitySummary";
import type {
  OpenBuildDetailsHandler,
  OpenExternalHandler,
  OpenNodeDetailsHandler,
  RetryExecutorsHandler
} from "./components/NodeCapacityViewTypes";
import { useCapacityTimestamp } from "./hooks/useCapacityTimestamp";
import {
  isPoolOpen,
  type PoolOpenStates,
  useNodeCapacityExecutorLoading,
  usePoolOpenStates,
  useShowAllNodesPools
} from "./hooks/useNodeCapacityExecutorLoading";
import { useNodeCapacityMessages } from "./hooks/useNodeCapacityMessages";
import {
  getInitialState,
  type NodeCapacityState,
  nodeCapacityReducer
} from "./state/nodeCapacityState";
import {
  buildPinnedNodeIndex,
  EMPTY_POOL_FILTER,
  filterPinnedQueueItems,
  filterPools,
  type PoolFilter,
  poolNeedsAttention
} from "./state/nodeCapacityView";

const { useCallback, useEffect, useMemo, useReducer, useState } = React;

/** Executor loads follow the filter once typing pauses, not on every keystroke. */
const FILTER_LOAD_DELAY_MS = 300;

function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timeoutId = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timeoutId);
  }, [value, delayMs]);
  return settled;
}

/**
 * The header Refresh button is the single refresh action: error banners and
 * the empty state do not repeat it.
 *
 * Builds pinned to one node sit with the pools in severity order: above them
 * when one is stuck, after them otherwise.
 */
function NodeCapacityContent({
  state,
  visiblePools,
  filter,
  poolOpenStates,
  showAllNodesPoolIds,
  onFilterChange,
  onCollapsePools,
  onOpenExternal,
  onOpenNodeDetails,
  onOpenBuildDetails,
  onRetryExecutors,
  onToggleExpanded,
  onShowAllNodesChange
}: {
  state: NodeCapacityState;
  visiblePools: readonly NodeCapacityPoolViewModel[];
  filter: PoolFilter;
  poolOpenStates: PoolOpenStates;
  showAllNodesPoolIds: ReadonlySet<string>;
  onFilterChange: (filter: PoolFilter) => void;
  onCollapsePools: (poolIds: readonly string[]) => void;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onRetryExecutors: RetryExecutorsHandler;
  onToggleExpanded: (poolId: string, open: boolean) => void;
  onShowAllNodesChange: (poolId: string, showAll: boolean) => void;
}): React.JSX.Element {
  const pinnedNodes = useMemo(() => buildPinnedNodeIndex(state.pools), [state.pools]);
  const pinnedItems = useMemo(
    () => filterPinnedQueueItems(state.hiddenLabelQueueItems, filter),
    [state.hiddenLabelQueueItems, filter]
  );
  const attentionCount = useMemo(
    () => state.pools.filter(poolNeedsAttention).length,
    [state.pools]
  );
  const openVisiblePoolIds = visiblePools
    .filter((pool) => isPoolOpen(pool, poolOpenStates))
    .map((pool) => pool.id);
  const pinnedQueue =
    pinnedItems.length > 0 ? (
      <PinnedNodeQueue
        items={pinnedItems}
        pinnedNodes={pinnedNodes}
        onOpenExternal={onOpenExternal}
        onOpenNodeDetails={onOpenNodeDetails}
      />
    ) : null;
  const pinnedFirst = pinnedItems.some((item) => item.stuck);

  return (
    <>
      <PanelErrorList
        errors={state.errors}
        title="Refresh failed. Showing the last loaded capacity."
      />
      {/* Zero counts add nothing above the empty state. */}
      {state.pools.length > 0 ? <NodeCapacitySummary summary={state.summary} /> : null}
      {state.pools.length > 1 ? (
        <NodeCapacityPoolToolbar
          filter={filter}
          totalCount={state.pools.length}
          shownCount={visiblePools.length}
          attentionCount={attentionCount}
          canCollapse={openVisiblePoolIds.length > 0}
          onFilterChange={onFilterChange}
          onCollapseAll={() => onCollapsePools(openVisiblePoolIds)}
        />
      ) : null}
      {pinnedFirst ? pinnedQueue : null}
      <NodeCapacityPoolList
        pools={visiblePools}
        nodeQuery={filter.query}
        hasPools={state.pools.length > 0}
        poolOpenStates={poolOpenStates}
        showAllNodesPoolIds={showAllNodesPoolIds}
        onClearFilter={() => onFilterChange(EMPTY_POOL_FILTER)}
        onOpenExternal={onOpenExternal}
        onOpenNodeDetails={onOpenNodeDetails}
        onOpenBuildDetails={onOpenBuildDetails}
        onRetryExecutors={onRetryExecutors}
        onToggleExpanded={onToggleExpanded}
        onShowAllNodesChange={onShowAllNodesChange}
      />
      {pinnedFirst ? null : pinnedQueue}
    </>
  );
}

export function NodeCapacityApp(): React.JSX.Element {
  const [state, dispatch] = useReducer(nodeCapacityReducer, undefined, getInitialState);
  const postMessage: (message: NodeCapacityIncomingMessage) => void = postVsCodeMessage;
  const handleOpenExternal = useOpenExternalMessage(postMessage);
  useNodeCapacityMessages(dispatch);

  const timestamp = useCapacityTimestamp(state.updatedAt, state.hasLoaded);
  const [filter, setFilter] = useState<PoolFilter>(EMPTY_POOL_FILTER);
  const visiblePools = useMemo(() => filterPools(state.pools, filter), [state.pools, filter]);
  // Rows a filter change reveals load their running work once typing pauses.
  const loadingFilter = useSettledValue(filter, FILTER_LOAD_DELAY_MS);
  const loadingPools = useMemo(
    () => (loadingFilter === filter ? visiblePools : filterPools(state.pools, loadingFilter)),
    [loadingFilter, filter, visiblePools, state.pools]
  );
  const { poolOpenStates, handlePoolToggle, collapsePools } = usePoolOpenStates(state.pools);
  const { showAllNodesPoolIds, handleShowAllNodesChange } = useShowAllNodesPools();
  const { handleRetryExecutors, reloadAllExecutors } = useNodeCapacityExecutorLoading(
    loadingPools,
    state.updatedAt,
    poolOpenStates,
    showAllNodesPoolIds,
    loadingFilter.query,
    dispatch,
    postMessage
  );

  const handleOpenNodeDetails = useCallback(
    (nodeUrl: string, label?: string) => {
      const message: OpenNodeDetailsMessage = { type: "openNodeDetails", nodeUrl, label };
      postMessage(message);
    },
    [postMessage]
  );

  const handleOpenBuildDetails = useCallback(
    (buildUrl: string, label?: string) => {
      const message: OpenBuildDetailsMessage = { type: "openBuildDetails", buildUrl, label };
      postMessage(message);
    },
    [postMessage]
  );

  const handleRefresh = useCallback(() => {
    reloadAllExecutors();
    postMessage({ type: "refreshNodeCapacity" });
  }, [reloadAllExecutors, postMessage]);

  if (state.loading && !state.hasLoaded) {
    return (
      <PanelInitialLoadingGate
        loading={state.loading}
        hasLoaded={state.hasLoaded}
        variant="capacity"
      />
    );
  }

  const loadFailed = state.errors.length > 0 && !state.hasData;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        {state.loading ? (
          <div className="fixed inset-x-0 top-0 z-50">
            <Progress indeterminate className="h-px rounded-none" />
          </div>
        ) : null}
        <NodeCapacityHeader
          environmentLabel={state.environmentLabel}
          loading={state.loading}
          loadFailed={loadFailed}
          {...timestamp}
          onRefresh={handleRefresh}
        />

        <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4" aria-busy={state.loading}>
          {loadFailed ? (
            <PanelErrorList
              errors={state.errors}
              title="Couldn't load node capacity"
              className="flex flex-col gap-1"
            />
          ) : (
            <NodeCapacityContent
              state={state}
              visiblePools={visiblePools}
              filter={filter}
              poolOpenStates={poolOpenStates}
              showAllNodesPoolIds={showAllNodesPoolIds}
              onFilterChange={setFilter}
              onCollapsePools={collapsePools}
              onOpenExternal={handleOpenExternal}
              onOpenNodeDetails={handleOpenNodeDetails}
              onOpenBuildDetails={handleOpenBuildDetails}
              onRetryExecutors={handleRetryExecutors}
              onToggleExpanded={handlePoolToggle}
              onShowAllNodesChange={handleShowAllNodesChange}
            />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

import * as React from "react";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
import { Progress } from "../../shared/webview/components/ui/progress";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { useOpenExternalMessage } from "../../shared/webview/hooks/useOpenExternalMessage";
import { usePanelPostMessage } from "../../shared/webview/hooks/usePanelPostMessage";
import type {
  NodeCapacityIncomingMessage,
  OpenNodeDetailsMessage
} from "../shared/NodeCapacityPanelMessages";
import { NodeCapacityHeader } from "./components/NodeCapacityHeader";
import { NodeCapacityPoolList } from "./components/NodeCapacityPoolList";
import { HiddenLabelQueue } from "./components/NodeCapacityQueue";
import { NodeCapacitySummary } from "./components/NodeCapacitySummary";
import type {
  OpenExternalHandler,
  OpenNodeDetailsHandler,
  RetryExecutorsHandler
} from "./components/NodeCapacityViewTypes";
import { useCapacityTimestamp } from "./hooks/useCapacityTimestamp";
import {
  type PoolOpenStates,
  useNodeCapacityExecutorLoading,
  usePoolOpenStates
} from "./hooks/useNodeCapacityExecutorLoading";
import { useNodeCapacityMessages } from "./hooks/useNodeCapacityMessages";
import {
  getInitialState,
  type NodeCapacityState,
  nodeCapacityReducer
} from "./state/nodeCapacityState";

const { useCallback, useReducer } = React;

/**
 * The header Refresh button is the single refresh action: error banners and
 * the empty state do not repeat it.
 */
function NodeCapacityContent({
  state,
  poolOpenStates,
  onOpenExternal,
  onOpenNodeDetails,
  onRetryExecutors,
  onToggleExpanded
}: {
  state: NodeCapacityState;
  poolOpenStates: PoolOpenStates;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onRetryExecutors: RetryExecutorsHandler;
  onToggleExpanded: (poolId: string, open: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      <PanelErrorList
        errors={state.errors}
        title="Refresh failed. Showing the last loaded capacity."
      />
      {/* Six zero counts add nothing above the empty state. */}
      {state.pools.length > 0 ? <NodeCapacitySummary state={state} /> : null}
      {state.hiddenLabelQueueItems.length > 0 ? (
        <HiddenLabelQueue items={state.hiddenLabelQueueItems} onOpenExternal={onOpenExternal} />
      ) : null}

      <NodeCapacityPoolList
        pools={state.pools}
        poolOpenStates={poolOpenStates}
        onOpenExternal={onOpenExternal}
        onOpenNodeDetails={onOpenNodeDetails}
        onRetryExecutors={onRetryExecutors}
        onToggleExpanded={onToggleExpanded}
      />
    </>
  );
}

export function NodeCapacityApp(): React.JSX.Element {
  const [state, dispatch] = useReducer(nodeCapacityReducer, undefined, getInitialState);
  const postMessage = usePanelPostMessage<NodeCapacityIncomingMessage>();
  const handleOpenExternal = useOpenExternalMessage(postMessage);
  useNodeCapacityMessages(dispatch);

  const timestamp = useCapacityTimestamp(state.updatedAt, state.hasLoaded);
  const { poolOpenStates, handlePoolToggle } = usePoolOpenStates(state.pools);
  const { handleRetryExecutors, reloadAllExecutors } = useNodeCapacityExecutorLoading(
    state.pools,
    state.updatedAt,
    poolOpenStates,
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
              poolOpenStates={poolOpenStates}
              onOpenExternal={handleOpenExternal}
              onOpenNodeDetails={handleOpenNodeDetails}
              onRetryExecutors={handleRetryExecutors}
              onToggleExpanded={handlePoolToggle}
            />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

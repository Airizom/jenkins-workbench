import type * as React from "react";
import type { NodeCapacityPoolViewModel } from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { EmptyState } from "../../../shared/webview/components/EmptyState";
import { Button } from "../../../shared/webview/components/ui/button";
import { RefreshIcon, ServerIcon } from "../../../shared/webview/icons";
import { isPoolOpen, type PoolOpenStates } from "../hooks/useNodeCapacityExecutorLoading";
import { NodeCapacityPoolPanel } from "./NodeCapacityPoolPanel";
import type {
  OpenExternalHandler,
  OpenNodeDetailsHandler,
  RetryExecutorsHandler
} from "./NodeCapacityViewTypes";

function NoPoolsState({ onRefresh }: { onRefresh: () => void }): React.JSX.Element {
  return (
    <EmptyState
      icon={<ServerIcon className="h-4 w-4" />}
      title="No node capacity data"
      description="Jenkins returned no label pools for this environment. Refresh once agents are connected."
      action={
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshIcon className="h-3.5 w-3.5" />
          Refresh
        </Button>
      }
    />
  );
}

export function NodeCapacityPoolList({
  pools,
  poolOpenStates,
  onRefresh,
  onOpenExternal,
  onOpenNodeDetails,
  onRetryExecutors,
  onToggleExpanded
}: {
  pools: readonly NodeCapacityPoolViewModel[];
  poolOpenStates: PoolOpenStates;
  onRefresh: () => void;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onRetryExecutors: RetryExecutorsHandler;
  onToggleExpanded: (poolId: string, open: boolean) => void;
}): React.JSX.Element {
  return (
    <section className="space-y-3" aria-label="Label pools">
      {pools.length === 0 ? (
        <NoPoolsState onRefresh={onRefresh} />
      ) : (
        pools.map((pool) => (
          <NodeCapacityPoolPanel
            key={pool.id}
            pool={pool}
            isOpen={isPoolOpen(pool, poolOpenStates)}
            onOpenExternal={onOpenExternal}
            onOpenNodeDetails={onOpenNodeDetails}
            onRetryExecutors={onRetryExecutors}
            onToggleExpanded={onToggleExpanded}
          />
        ))
      )}
    </section>
  );
}

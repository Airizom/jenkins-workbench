import type * as React from "react";
import type { NodeCapacityPoolViewModel } from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { EmptyState } from "../../../shared/webview/components/EmptyState";
import { Button } from "../../../shared/webview/components/ui/button";
import { SearchIcon, ServerIcon } from "../../../shared/webview/icons";
import { isPoolOpen, type PoolOpenStates } from "../hooks/useNodeCapacityExecutorLoading";
import { NodeCapacityPoolPanel } from "./NodeCapacityPoolPanel";
import type {
  OpenBuildDetailsHandler,
  OpenExternalHandler,
  OpenNodeDetailsHandler,
  RetryExecutorsHandler
} from "./NodeCapacityViewTypes";

/** No Refresh button here: the header's Refresh is the panel's single refresh action. */
function NoPoolsState(): React.JSX.Element {
  return (
    <EmptyState
      icon={<ServerIcon className="h-4 w-4" />}
      title="No node capacity data"
      description="Jenkins returned no label pools for this environment. Refresh once agents are connected."
    />
  );
}

function NoMatchesState({ onClearFilter }: { onClearFilter: () => void }): React.JSX.Element {
  return (
    <EmptyState
      icon={<SearchIcon className="h-4 w-4" />}
      title="No pools match"
      description="No label, node, or queued job matches the current filter."
      action={
        <Button variant="outline" size="sm" onClick={onClearFilter}>
          Clear filter
        </Button>
      }
    />
  );
}

export function NodeCapacityPoolList({
  pools,
  nodeQuery,
  hasPools,
  poolOpenStates,
  showAllNodesPoolIds,
  onClearFilter,
  onOpenExternal,
  onOpenNodeDetails,
  onOpenBuildDetails,
  onRetryExecutors,
  onToggleExpanded,
  onShowAllNodesChange
}: {
  /** Pools that pass the current filter. */
  pools: readonly NodeCapacityPoolViewModel[];
  /** Filter text; pools matched by node name list only the matching nodes. */
  nodeQuery: string;
  /** Whether Jenkins returned any pools before filtering. */
  hasPools: boolean;
  poolOpenStates: PoolOpenStates;
  showAllNodesPoolIds: ReadonlySet<string>;
  onClearFilter: () => void;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onRetryExecutors: RetryExecutorsHandler;
  onToggleExpanded: (poolId: string, open: boolean) => void;
  onShowAllNodesChange: (poolId: string, showAll: boolean) => void;
}): React.JSX.Element {
  return (
    <section className="space-y-3" aria-label="Label pools">
      {!hasPools ? (
        <NoPoolsState />
      ) : pools.length === 0 ? (
        <NoMatchesState onClearFilter={onClearFilter} />
      ) : (
        pools.map((pool) => (
          <NodeCapacityPoolPanel
            key={pool.id}
            pool={pool}
            isOpen={isPoolOpen(pool, poolOpenStates)}
            showAllNodes={showAllNodesPoolIds.has(pool.id)}
            nodeQuery={nodeQuery}
            onOpenExternal={onOpenExternal}
            onOpenNodeDetails={onOpenNodeDetails}
            onOpenBuildDetails={onOpenBuildDetails}
            onRetryExecutors={onRetryExecutors}
            onToggleExpanded={onToggleExpanded}
            onShowAllNodesChange={onShowAllNodesChange}
          />
        ))
      )}
    </section>
  );
}

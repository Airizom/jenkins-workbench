import * as React from "react";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import type { NodeCapacityIncomingMessage } from "../../shared/NodeCapacityPanelMessages";
import type { NodeCapacityAction } from "../state/nodeCapacityState";

const { useCallback, useEffect, useMemo, useRef, useState } = React;

type ExecutorLoadCandidate = Pick<
  NodeCapacityNodeViewModel,
  "nodeUrl" | "isOffline" | "isTemporarilyOffline" | "busyExecutors" | "totalExecutors"
>;

export type PoolOpenStates = ReadonlyMap<string, boolean>;

/** Pools default to open when they signal a problem, until the user toggles them. */
export function isPoolOpen(pool: NodeCapacityPoolViewModel, poolOpenStates: PoolOpenStates) {
  return poolOpenStates.get(pool.id) ?? pool.severity !== "normal";
}

/**
 * Returns the expanded nodes whose running work must be (re)loaded. Nodes with
 * busy executors are reloaded on every capacity snapshot (`snapshotId`), since
 * builds can turn over without the counts changing. Idle nodes are requested
 * again only when their executor counts or connectivity change, or after a
 * manual refresh bumps `refreshGeneration`.
 */
export function planExecutorLoads(
  nodes: readonly ExecutorLoadCandidate[],
  requestedKeys: Map<string, string>,
  refreshGeneration: number,
  snapshotId: string
): string[] {
  const nodeUrls = new Set<string>();
  for (const node of nodes) {
    if (!node.nodeUrl || nodeUrls.has(node.nodeUrl)) {
      continue;
    }
    const key = [
      refreshGeneration,
      node.isOffline,
      node.isTemporarilyOffline,
      node.busyExecutors,
      node.totalExecutors,
      node.busyExecutors > 0 ? snapshotId : ""
    ].join(":");
    if (requestedKeys.get(node.nodeUrl) === key) {
      continue;
    }
    requestedKeys.set(node.nodeUrl, key);
    nodeUrls.add(node.nodeUrl);
  }
  return [...nodeUrls].sort();
}

export function usePoolOpenStates(): {
  poolOpenStates: PoolOpenStates;
  handlePoolToggle: (poolId: string, open: boolean) => void;
} {
  const [poolOpenStates, setPoolOpenStates] = useState<PoolOpenStates>(() => new Map());
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
  return { poolOpenStates, handlePoolToggle };
}

/**
 * Loads running work for nodes in expanded pools. `reloadAllExecutors` forces
 * the next plan to re-request every expanded node (used by manual refresh).
 */
export function useNodeCapacityExecutorLoading(
  pools: readonly NodeCapacityPoolViewModel[],
  snapshotId: string,
  poolOpenStates: PoolOpenStates,
  dispatch: React.Dispatch<NodeCapacityAction>,
  postMessage: (message: NodeCapacityIncomingMessage) => void
): { handleRetryExecutors: (nodeUrl: string) => void; reloadAllExecutors: () => void } {
  const expandedNodes = useMemo(
    () => pools.filter((pool) => isPoolOpen(pool, poolOpenStates)).flatMap((pool) => pool.nodes),
    [pools, poolOpenStates]
  );

  const requestIdRef = useRef(0);
  const requestExecutors = useCallback(
    (nodeUrls: string[]) => {
      if (nodeUrls.length === 0) {
        return;
      }
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      dispatch({ type: "executorsRequested", requestId, nodeUrls });
      postMessage({ type: "loadNodeCapacityExecutors", requestId, nodeUrls });
    },
    [dispatch, postMessage]
  );

  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const requestedExecutorKeys = useRef(new Map<string, string>());
  useEffect(() => {
    requestExecutors(
      planExecutorLoads(expandedNodes, requestedExecutorKeys.current, refreshGeneration, snapshotId)
    );
  }, [expandedNodes, refreshGeneration, snapshotId, requestExecutors]);

  const handleRetryExecutors = useCallback(
    (nodeUrl: string) => {
      // The node's plan key stays recorded, so the planner does not issue a
      // second request for it when the retry updates state.
      requestExecutors([nodeUrl]);
    },
    [requestExecutors]
  );

  const reloadAllExecutors = useCallback(() => {
    setRefreshGeneration((generation) => generation + 1);
  }, []);

  return { handleRetryExecutors, reloadAllExecutors };
}

import * as React from "react";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import type { NodeCapacityIncomingMessage } from "../../shared/NodeCapacityPanelMessages";
import type { NodeCapacityAction } from "../state/nodeCapacityState";
import { filterPoolNodes, getVisiblePoolNodes, orderPoolNodes } from "../state/nodeCapacityView";

const { useCallback, useEffect, useMemo, useRef, useState } = React;

type ExecutorLoadCandidate = Pick<
  NodeCapacityNodeViewModel,
  "nodeUrl" | "isOffline" | "isTemporarilyOffline" | "busyExecutors" | "totalExecutors"
>;

/** Effective open state per pool id; pools missing from the map are closed. */
export type PoolOpenStates = ReadonlyMap<string, boolean>;

export function isPoolOpen(pool: NodeCapacityPoolViewModel, poolOpenStates: PoolOpenStates) {
  return poolOpenStates.get(pool.id) ?? false;
}

/**
 * Adds pools that signal a problem to the auto-opened set. Pools are only ever
 * added: a pool that recovers stays open, and one that degrades opens once, so
 * 10s polling never collapses a pool the user is reading. Returns `previous`
 * unchanged when nothing new opened.
 */
export function collectAutoOpenedPoolIds(
  pools: readonly Pick<NodeCapacityPoolViewModel, "id" | "severity">[],
  previous: ReadonlySet<string>
): ReadonlySet<string> {
  const added = pools.filter((pool) => pool.severity !== "normal" && !previous.has(pool.id));
  if (added.length === 0) {
    return previous;
  }
  return new Set([...previous, ...added.map((pool) => pool.id)]);
}

/** User toggles always win over the automatic decision. */
export function resolvePoolOpenStates(
  autoOpenedPoolIds: ReadonlySet<string>,
  userOpenStates: PoolOpenStates
): PoolOpenStates {
  const resolved = new Map<string, boolean>();
  for (const poolId of autoOpenedPoolIds) {
    resolved.set(poolId, true);
  }
  for (const [poolId, open] of userOpenStates) {
    resolved.set(poolId, open);
  }
  return resolved;
}

/**
 * Returns the expanded nodes whose running work must be (re)loaded. Nodes with
 * busy executors are reloaded on every capacity snapshot (`snapshotId`), since
 * builds can turn over without the counts changing. Idle nodes are requested
 * again only when their executor counts or connectivity change, or after a
 * manual refresh bumps `refreshGeneration`. Busy nodes ignore the generation:
 * the refresh's new snapshot reloads them, so the bump must not request them
 * a second time against the old snapshot. Keys for nodes no longer expanded
 * are dropped, so a node that leaves and returns (a snapshot that omitted it,
 * or a collapsed pool) is requested again instead of rendering unhydrated.
 */
export function planExecutorLoads(
  nodes: readonly ExecutorLoadCandidate[],
  requestedKeys: Map<string, string>,
  refreshGeneration: number,
  snapshotId: string
): string[] {
  const currentNodeUrls = new Set(nodes.map((node) => node.nodeUrl));
  for (const nodeUrl of requestedKeys.keys()) {
    if (!currentNodeUrls.has(nodeUrl)) {
      requestedKeys.delete(nodeUrl);
    }
  }
  const nodeUrls = new Set<string>();
  for (const node of nodes) {
    if (!node.nodeUrl || nodeUrls.has(node.nodeUrl)) {
      continue;
    }
    const key = [
      node.isOffline,
      node.isTemporarilyOffline,
      node.busyExecutors,
      node.totalExecutors,
      node.busyExecutors > 0 ? snapshotId : refreshGeneration
    ].join(":");
    if (requestedKeys.get(node.nodeUrl) === key) {
      continue;
    }
    requestedKeys.set(node.nodeUrl, key);
    nodeUrls.add(node.nodeUrl);
  }
  return [...nodeUrls].sort();
}

export function usePoolOpenStates(pools: readonly NodeCapacityPoolViewModel[]): {
  poolOpenStates: PoolOpenStates;
  handlePoolToggle: (poolId: string, open: boolean) => void;
  collapsePools: (poolIds: readonly string[]) => void;
} {
  const [userOpenStates, setUserOpenStates] = useState<PoolOpenStates>(() => new Map());
  const autoOpenedRef = useRef<ReadonlySet<string>>(new Set());
  // Idempotent for the same `pools`, so a repeated render cannot double-apply.
  const autoOpenedPoolIds = useMemo(() => {
    autoOpenedRef.current = collectAutoOpenedPoolIds(pools, autoOpenedRef.current);
    return autoOpenedRef.current;
  }, [pools]);
  const poolOpenStates = useMemo(
    () => resolvePoolOpenStates(autoOpenedPoolIds, userOpenStates),
    [autoOpenedPoolIds, userOpenStates]
  );
  const handlePoolToggle = useCallback((poolId: string, open: boolean) => {
    setUserOpenStates((current) => {
      if (current.get(poolId) === open) {
        return current;
      }
      const next = new Map(current);
      next.set(poolId, open);
      return next;
    });
  }, []);
  // Recorded as user choices, so problem pools stay collapsed until toggled.
  const collapsePools = useCallback((poolIds: readonly string[]) => {
    setUserOpenStates((current) => {
      const next = new Map(current);
      for (const poolId of poolIds) {
        next.set(poolId, false);
      }
      return next;
    });
  }, []);
  return { poolOpenStates, handlePoolToggle, collapsePools };
}

/** Pools whose node list the user expanded past the preview limit. */
export function useShowAllNodesPools(): {
  showAllNodesPoolIds: ReadonlySet<string>;
  handleShowAllNodesChange: (poolId: string, showAll: boolean) => void;
} {
  const [showAllNodesPoolIds, setShowAllNodesPoolIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const handleShowAllNodesChange = useCallback((poolId: string, showAll: boolean) => {
    setShowAllNodesPoolIds((current) => {
      if (current.has(poolId) === showAll) {
        return current;
      }
      const next = new Set(current);
      if (showAll) {
        next.add(poolId);
      } else {
        next.delete(poolId);
      }
      return next;
    });
  }, []);
  return { showAllNodesPoolIds, handleShowAllNodesChange };
}

/**
 * Nodes whose rows are on screen: in expanded pools that pass the filter,
 * narrowed by a node-name query, and within each pool's preview limit unless
 * the user asked to see all of them. Mirrors `NodeCapacityPoolPanel`.
 */
export function collectRenderedNodes(
  visiblePools: readonly NodeCapacityPoolViewModel[],
  poolOpenStates: PoolOpenStates,
  showAllNodesPoolIds: ReadonlySet<string>,
  query: string
): NodeCapacityNodeViewModel[] {
  return visiblePools
    .filter((pool) => isPoolOpen(pool, poolOpenStates))
    .flatMap((pool) =>
      getVisiblePoolNodes(
        orderPoolNodes(filterPoolNodes(pool, query)),
        showAllNodesPoolIds.has(pool.id)
      )
    );
}

/**
 * Loads running work for rendered nodes (see `collectRenderedNodes`), so
 * filtered-out pools and capped rows never cost a Jenkins request.
 * `reloadAllExecutors` forces the next plan to re-request every rendered node
 * (used by manual refresh).
 */
export function useNodeCapacityExecutorLoading(
  visiblePools: readonly NodeCapacityPoolViewModel[],
  snapshotId: string,
  poolOpenStates: PoolOpenStates,
  showAllNodesPoolIds: ReadonlySet<string>,
  query: string,
  dispatch: React.Dispatch<NodeCapacityAction>,
  postMessage: (message: NodeCapacityIncomingMessage) => void
): { handleRetryExecutors: (nodeUrl: string) => void; reloadAllExecutors: () => void } {
  const expandedNodes = useMemo(
    () => collectRenderedNodes(visiblePools, poolOpenStates, showAllNodesPoolIds, query),
    [visiblePools, poolOpenStates, showAllNodesPoolIds, query]
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

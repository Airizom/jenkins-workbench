import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityNodeExecutorsUpdateMessage,
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacityViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { createEmptyNodeCapacitySummary } from "../../../../shared/nodeCapacity/NodeCapacityDefaults";
import {
  createLoadingPanelStateHelpers,
  FALLBACK_UPDATED_AT
} from "../../../shared/webview/state/createPanelStateHelpers";

export type NodeCapacityState = NodeCapacityViewModel & {
  hasLoaded: boolean;
};

export type NodeCapacityAction =
  | { type: "setLoading"; value: boolean }
  | { type: "updateNodeCapacity"; payload: NodeCapacityViewModel }
  | {
      type: "updateNodeCapacityNodeExecutors";
      payload: NodeCapacityNodeExecutorsUpdateMessage["payload"];
    };

const FALLBACK_STATE: NodeCapacityState = {
  environmentLabel: "Jenkins",
  updatedAt: FALLBACK_UPDATED_AT,
  summary: createEmptyNodeCapacitySummary(),
  pools: [],
  hiddenLabelQueueItems: [],
  errors: [],
  loading: true,
  hasLoaded: false
};

export function buildInitialState(initialState: NodeCapacityViewModel): NodeCapacityState {
  return {
    ...FALLBACK_STATE,
    ...initialState,
    summary: initialState.summary ?? FALLBACK_STATE.summary,
    pools: initialState.pools ?? [],
    hiddenLabelQueueItems: initialState.hiddenLabelQueueItems ?? [],
    errors: initialState.errors ?? [],
    loading: false,
    hasLoaded: true
  };
}

const panelStateHelpers = createLoadingPanelStateHelpers({
  fallback: FALLBACK_STATE,
  buildInitial: buildInitialState
});

export function nodeCapacityReducer(
  state: NodeCapacityState,
  action: NodeCapacityAction
): NodeCapacityState {
  switch (action.type) {
    case "setLoading":
      return panelStateHelpers.handleSetLoading(state, action.value);
    case "updateNodeCapacity": {
      const next = panelStateHelpers.handleFullUpdate(state, action.payload);
      return {
        ...next,
        pools: carryOverLoadedExecutors(state.pools, next.pools)
      };
    }
    case "updateNodeCapacityNodeExecutors": {
      return {
        ...state,
        pools: applyExecutorUpdates(state.pools, action.payload)
      };
    }
    default:
      return state;
  }
}

export function getInitialState(): NodeCapacityState {
  return panelStateHelpers.getInitialState();
}

/** Mirrors NODE_CAPACITY_VISIBLE_REFRESH_INTERVAL_MS in NodeCapacityPanel.ts. */
export const NODE_CAPACITY_REFRESH_INTERVAL_MS = 10_000;

/** Keep the stale badge consistent with the relative timestamp's sub-minute label. */
export const NODE_CAPACITY_STALE_AFTER_MS = 60_000;

export function isStaleCapacityTimestamp(updatedAt: string | undefined, now: number): boolean {
  if (!updatedAt) {
    return false;
  }
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return false;
  }
  return now - timestamp > NODE_CAPACITY_STALE_AFTER_MS;
}

function applyExecutorUpdates(
  pools: NodeCapacityPoolViewModel[],
  updates: NodeCapacityNodeExecutorsUpdateMessage["payload"]
): NodeCapacityPoolViewModel[] {
  const executorsByNodeUrl = new Map(updates.map((entry) => [entry.nodeUrl, entry.executors]));
  return mapNodesInPools(pools, (node) => {
    if (!node.nodeUrl || !executorsByNodeUrl.has(node.nodeUrl)) {
      return node;
    }
    return {
      ...node,
      executorsLoaded: true,
      executors: executorsByNodeUrl.get(node.nodeUrl) ?? []
    };
  });
}

/**
 * Full updates rebuild every node with `executorsLoaded: false`; keep previously
 * hydrated executor lists so expanded pools do not flash empty between the
 * update and the follow-up executor fetch.
 */
function carryOverLoadedExecutors(
  previousPools: NodeCapacityPoolViewModel[],
  nextPools: NodeCapacityPoolViewModel[]
): NodeCapacityPoolViewModel[] {
  const loadedExecutorsByNodeUrl = new Map<string, NodeCapacityExecutorViewModel[]>();
  for (const pool of previousPools) {
    for (const node of pool.nodes) {
      if (node.nodeUrl && node.executorsLoaded) {
        loadedExecutorsByNodeUrl.set(node.nodeUrl, node.executors);
      }
    }
  }
  if (loadedExecutorsByNodeUrl.size === 0) {
    return nextPools;
  }
  return mapNodesInPools(nextPools, (node) => {
    if (node.executorsLoaded || !node.nodeUrl) {
      return node;
    }
    const executors = loadedExecutorsByNodeUrl.get(node.nodeUrl);
    if (!executors) {
      return node;
    }
    return { ...node, executorsLoaded: true, executors };
  });
}

function mapNodesInPools(
  pools: NodeCapacityPoolViewModel[],
  mapNode: (node: NodeCapacityNodeViewModel) => NodeCapacityNodeViewModel
): NodeCapacityPoolViewModel[] {
  return pools.map((pool) => ({
    ...pool,
    nodes: pool.nodes.map(mapNode)
  }));
}

import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacityViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { createEmptyNodeCapacitySummary } from "../../../../shared/nodeCapacity/NodeCapacityDefaults";
import {
  FALLBACK_UPDATED_AT,
  createLoadingPanelStateHelpers
} from "../../../shared/webview/state/createPanelStateHelpers";

export type NodeCapacityState = NodeCapacityViewModel & {
  hasLoaded: boolean;
};

export type NodeCapacityAction =
  | { type: "setLoading"; value: boolean }
  | { type: "updateNodeCapacity"; payload: NodeCapacityViewModel }
  | {
      type: "updateNodeCapacityNodeExecutors";
      payload: Array<{ nodeUrl: string; executors: NodeCapacityExecutorViewModel[] }>;
    };

export const FALLBACK_STATE: NodeCapacityState = {
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
      const executorsByNodeUrl = new Map(
        action.payload.map((entry) => [entry.nodeUrl, entry.executors])
      );
      return {
        ...state,
        pools: state.pools.map((pool) => ({
          ...pool,
          nodes: pool.nodes.map((node) => {
            if (!node.nodeUrl || !executorsByNodeUrl.has(node.nodeUrl)) {
              return node;
            }
            return {
              ...node,
              executorsLoaded: true,
              executors: executorsByNodeUrl.get(node.nodeUrl) ?? []
            };
          })
        }))
      };
    }
    default:
      return state;
  }
}

export function getInitialState(): NodeCapacityState {
  return panelStateHelpers.getInitialState();
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
  return nextPools.map((pool) => ({
    ...pool,
    nodes: pool.nodes.map((node): NodeCapacityNodeViewModel => {
      if (node.executorsLoaded || !node.nodeUrl) {
        return node;
      }
      const executors = loadedExecutorsByNodeUrl.get(node.nodeUrl);
      if (!executors) {
        return node;
      }
      return { ...node, executorsLoaded: true, executors };
    })
  }));
}

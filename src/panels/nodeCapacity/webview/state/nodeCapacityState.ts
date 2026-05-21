import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { createEmptyNodeCapacitySummary } from "../../../../shared/nodeCapacity/NodeCapacityDefaults";
import {
  FALLBACK_UPDATED_AT,
  preserveLoadingOnFullUpdate,
  readInitialPanelState
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

export function nodeCapacityReducer(
  state: NodeCapacityState,
  action: NodeCapacityAction
): NodeCapacityState {
  switch (action.type) {
    case "setLoading":
      return { ...state, loading: action.value };
    case "updateNodeCapacity": {
      const nextState = buildInitialState(action.payload);
      return preserveLoadingOnFullUpdate(state, nextState);
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
  return readInitialPanelState(FALLBACK_STATE, buildInitialState);
}

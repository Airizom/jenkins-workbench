import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";

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

const FALLBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";

export const FALLBACK_STATE: NodeCapacityState = {
  environmentLabel: "Jenkins",
  updatedAt: FALLBACK_UPDATED_AT,
  summary: {
    totalNodes: 0,
    onlineNodes: 0,
    offlineNodes: 0,
    totalExecutors: 0,
    busyExecutors: 0,
    idleExecutors: 0,
    offlineExecutors: 0,
    queuedCount: 0,
    stuckCount: 0,
    blockedCount: 0,
    buildableCount: 0,
    bottleneckCount: 0
  },
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
      return {
        ...nextState,
        loading: state.loading
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
  const candidate = (window as { __INITIAL_STATE__?: NodeCapacityViewModel }).__INITIAL_STATE__;
  if (!candidate) {
    return FALLBACK_STATE;
  }
  return buildInitialState(candidate);
}

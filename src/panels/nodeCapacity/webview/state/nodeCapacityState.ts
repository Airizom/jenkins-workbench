import type {
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
import type { NodeCapacityOutgoingMessage } from "../../shared/NodeCapacityPanelMessages";

export type NodeCapacityState = NodeCapacityViewModel & {
  hasLoaded: boolean;
  /**
   * True once a snapshot with real capacity data arrived. A later failed
   * refresh keeps that data (marked stale) instead of replacing it with zeros.
   */
  hasData: boolean;
  /** Latest executor request id per node URL; older responses are ignored. */
  executorRequestIds: Readonly<Record<string, number>>;
};

/** Local action dispatched when the webview posts `loadNodeCapacityExecutors`. */
export interface NodeCapacityExecutorsRequestedAction {
  type: "executorsRequested";
  requestId: number;
  nodeUrls: string[];
}

export type NodeCapacityAction = NodeCapacityOutgoingMessage | NodeCapacityExecutorsRequestedAction;

const FALLBACK_STATE: NodeCapacityState = {
  environmentLabel: "Jenkins",
  updatedAt: FALLBACK_UPDATED_AT,
  summary: createEmptyNodeCapacitySummary(),
  pools: [],
  hiddenLabelQueueItems: [],
  errors: [],
  loading: true,
  hasLoaded: false,
  hasData: false,
  executorRequestIds: {}
};

/** The host's error view model: errors with no capacity data at all. */
function isFailedSnapshot(model: NodeCapacityViewModel): boolean {
  return (model.errors?.length ?? 0) > 0 && (model.pools?.length ?? 0) === 0;
}

export function buildInitialState(initialState: NodeCapacityViewModel): NodeCapacityState {
  return {
    ...FALLBACK_STATE,
    ...initialState,
    summary: initialState.summary ?? FALLBACK_STATE.summary,
    pools: initialState.pools ?? [],
    hiddenLabelQueueItems: initialState.hiddenLabelQueueItems ?? [],
    errors: initialState.errors ?? [],
    loading: false,
    hasLoaded: true,
    hasData: !isFailedSnapshot(initialState),
    executorRequestIds: {}
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
      if (state.hasData && isFailedSnapshot(action.payload)) {
        return {
          ...state,
          errors: action.payload.errors,
          hasLoaded: true
        };
      }
      const next = panelStateHelpers.handleFullUpdate(state, action.payload);
      return {
        ...next,
        hasData: state.hasData || !isFailedSnapshot(action.payload),
        executorRequestIds: state.executorRequestIds,
        pools: carryOverLoadedExecutors(state.pools, next.pools)
      };
    }
    case "executorsRequested":
      return markExecutorsRequested(state, action);
    case "updateNodeCapacityNodeExecutors":
      return applyExecutorUpdates(state, action);
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

function markExecutorsRequested(
  state: NodeCapacityState,
  action: NodeCapacityExecutorsRequestedAction
): NodeCapacityState {
  if (action.nodeUrls.length === 0) {
    return state;
  }
  const requested = new Set(action.nodeUrls);
  const executorRequestIds = { ...state.executorRequestIds };
  for (const nodeUrl of requested) {
    executorRequestIds[nodeUrl] = action.requestId;
  }
  return {
    ...state,
    executorRequestIds,
    pools: mapNodesInPools(state.pools, (node) =>
      node.nodeUrl && requested.has(node.nodeUrl)
        ? { ...node, executorsLoadState: "loading", executorsError: undefined }
        : node
    )
  };
}

function applyExecutorUpdates(
  state: NodeCapacityState,
  action: NodeCapacityNodeExecutorsUpdateMessage
): NodeCapacityState {
  const current = action.payload.filter(
    (entry) => state.executorRequestIds[entry.nodeUrl] === action.requestId
  );
  if (current.length === 0) {
    return state;
  }
  const resultsByNodeUrl = new Map(current.map((entry) => [entry.nodeUrl, entry]));
  return {
    ...state,
    pools: mapNodesInPools(state.pools, (node) => {
      const result = node.nodeUrl ? resultsByNodeUrl.get(node.nodeUrl) : undefined;
      if (!result) {
        return node;
      }
      if (result.error !== undefined) {
        return { ...node, executorsLoadState: "error", executorsError: result.error };
      }
      return {
        ...node,
        executorsLoaded: true,
        executors: result.executors,
        executorsLoadState: undefined,
        executorsError: undefined
      };
    })
  };
}

/**
 * Full updates rebuild every node with `executorsLoaded: false` and no load
 * state; keep previously hydrated executor lists and in-flight/error status so
 * expanded pools do not flash empty or lose their inline error between the
 * update and the next executor response.
 */
function carryOverLoadedExecutors(
  previousPools: NodeCapacityPoolViewModel[],
  nextPools: NodeCapacityPoolViewModel[]
): NodeCapacityPoolViewModel[] {
  const previousByNodeUrl = new Map<string, NodeCapacityNodeViewModel>();
  for (const pool of previousPools) {
    for (const node of pool.nodes) {
      if (node.nodeUrl && (node.executorsLoaded || node.executorsLoadState)) {
        previousByNodeUrl.set(node.nodeUrl, node);
      }
    }
  }
  if (previousByNodeUrl.size === 0) {
    return nextPools;
  }
  return mapNodesInPools(nextPools, (node) => {
    const previous = node.nodeUrl ? previousByNodeUrl.get(node.nodeUrl) : undefined;
    if (!previous) {
      return node;
    }
    const carried: NodeCapacityNodeViewModel = {
      ...node,
      executorsLoadState: previous.executorsLoadState,
      executorsError: previous.executorsError
    };
    if (node.executorsLoaded || !previous.executorsLoaded) {
      return carried;
    }
    return { ...carried, executorsLoaded: true, executors: previous.executors };
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

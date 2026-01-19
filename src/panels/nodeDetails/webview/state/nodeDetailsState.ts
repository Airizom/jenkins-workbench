import type {
  NodeDetailsUpdateMessage,
  NodeDetailsViewModel
} from "../../shared/NodeDetailsContracts";

export type NodeDetailsIncomingMessage =
  | { type: "setLoading"; value?: boolean }
  | NodeDetailsUpdateMessage;

export type NodeDetailsState = NodeDetailsViewModel & {
  loading: boolean;
};

export type NodeDetailsAction =
  | { type: "setLoading"; value: boolean }
  | { type: "updateNodeDetails"; payload: NodeDetailsUpdateMessage };

const FALLBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";

export const FALLBACK_STATE: NodeDetailsState = {
  displayName: "Node Details",
  name: "Unknown",
  description: undefined,
  url: undefined,
  updatedAt: FALLBACK_UPDATED_AT,
  statusLabel: "Unknown",
  statusClass: "unknown",
  offlineReason: undefined,
  idleLabel: "Not available",
  executorsLabel: "Not available",
  labels: [],
  jnlpAgentLabel: undefined,
  launchSupportedLabel: undefined,
  manualLaunchLabel: undefined,
  executors: [],
  oneOffExecutors: [],
  monitorData: [],
  loadStatistics: [],
  rawJson: "",
  errors: [],
  advancedLoaded: false,
  loading: true
};

export function buildInitialState(initialState: NodeDetailsViewModel): NodeDetailsState {
  return {
    ...FALLBACK_STATE,
    ...initialState,
    labels: initialState.labels ?? [],
    executors: initialState.executors ?? [],
    oneOffExecutors: initialState.oneOffExecutors ?? [],
    monitorData: initialState.monitorData ?? [],
    loadStatistics: initialState.loadStatistics ?? [],
    errors: initialState.errors ?? [],
    advancedLoaded: initialState.advancedLoaded ?? false,
    loading: false
  };
}

export function nodeDetailsReducer(
  state: NodeDetailsState,
  action: NodeDetailsAction
): NodeDetailsState {
  switch (action.type) {
    case "setLoading":
      return { ...state, loading: action.value };
    case "updateNodeDetails":
      return buildInitialState(action.payload.payload);
    default:
      return state;
  }
}

export function getInitialState(): NodeDetailsState {
  const candidate = (window as { __INITIAL_STATE__?: NodeDetailsViewModel }).__INITIAL_STATE__;
  if (!candidate) {
    return FALLBACK_STATE;
  }
  return buildInitialState(candidate);
}

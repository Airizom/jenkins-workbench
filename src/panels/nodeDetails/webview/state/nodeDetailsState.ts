import {
  FALLBACK_UPDATED_AT,
  createLoadingPanelStateHelpers
} from "../../../shared/webview/state/createPanelStateHelpers";
import type {
  NodeDetailsUpdateMessage,
  NodeDetailsViewModel
} from "../../shared/NodeDetailsContracts";

export type NodeDetailsState = NodeDetailsViewModel & {
  loading: boolean;
  hasLoaded: boolean;
};

export type NodeDetailsAction =
  | { type: "setLoading"; value: boolean }
  | { type: "updateNodeDetails"; payload: NodeDetailsUpdateMessage };

export const FALLBACK_STATE: NodeDetailsState = {
  displayName: "Node Details",
  name: "Unknown",
  description: undefined,
  url: undefined,
  updatedAt: FALLBACK_UPDATED_AT,
  statusLabel: "Unknown",
  statusClass: "unknown",
  isOffline: false,
  isTemporarilyOffline: false,
  canTakeOffline: false,
  canBringOnline: false,
  canLaunchAgent: false,
  canOpenAgentInstructions: false,
  offlineReason: undefined,
  idleLabel: "Not available",
  executorsLabel: "Not available",
  labels: [],
  jnlpAgentLabel: undefined,
  launchSupportedLabel: undefined,
  manualLaunchLabel: undefined,
  executors: [],
  oneOffExecutors: [],
  queuedWork: {
    matchingQueueItems: [],
    anyQueueItems: [],
    selfLabelQueueItems: []
  },
  monitorData: [],
  loadStatistics: [],
  rawJson: "",
  errors: [],
  advancedLoaded: false,
  loading: true,
  hasLoaded: false
};

export function buildInitialState(initialState: NodeDetailsViewModel): NodeDetailsState {
  return {
    ...FALLBACK_STATE,
    ...initialState,
    labels: initialState.labels ?? [],
    executors: initialState.executors ?? [],
    oneOffExecutors: initialState.oneOffExecutors ?? [],
    queuedWork: initialState.queuedWork ?? FALLBACK_STATE.queuedWork,
    monitorData: initialState.monitorData ?? [],
    loadStatistics: initialState.loadStatistics ?? [],
    errors: initialState.errors ?? [],
    advancedLoaded: initialState.advancedLoaded ?? false,
    loading: false,
    hasLoaded: true
  };
}

const panelStateHelpers = createLoadingPanelStateHelpers({
  fallback: FALLBACK_STATE,
  buildInitial: buildInitialState
});

export function nodeDetailsReducer(
  state: NodeDetailsState,
  action: NodeDetailsAction
): NodeDetailsState {
  switch (action.type) {
    case "setLoading":
      return panelStateHelpers.handleSetLoading(state, action.value);
    case "updateNodeDetails":
      return panelStateHelpers.handleFullUpdate(state, action.payload.payload);
    default:
      return state;
  }
}

export function getInitialState(): NodeDetailsState {
  return panelStateHelpers.getInitialState();
}

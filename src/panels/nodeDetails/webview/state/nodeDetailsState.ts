import { getVsCodeState } from "../../../shared/webview/lib/vscodeApi";
import {
  createLoadingPanelStateHelpers,
  FALLBACK_UPDATED_AT
} from "../../../shared/webview/state/createPanelStateHelpers";
import { emptyNodeAgentLogState, type NodeAgentLogState } from "../../shared/NodeAgentLogContracts";
import type { NodeDetailsViewModel } from "../../shared/NodeDetailsContracts";
import type { NodeDetailsUpdateMessage } from "../../shared/NodeDetailsPanelMessages";
import {
  isNodeDetailsTab,
  NODE_DETAILS_TABS,
  type NodeDetailsTab
} from "../../shared/NodeDetailsTabs";

export type NodeDetailsState = NodeDetailsViewModel & {
  loading: boolean;
  activeTab: NodeDetailsTab;
  agentLog: NodeAgentLogState;
  hasLoaded: boolean;
  /**
   * Webview-only: diagnostics were requested and no update has answered yet.
   * Set optimistically on request so the Diagnostics tab shows its loading
   * state before the host's `setLoading` message arrives.
   */
  advancedRequested: boolean;
};

export type NodeDetailsAction =
  | { type: "setLoading"; value: boolean }
  | { type: "advancedRequested" }
  | { type: "selectTab"; tab: NodeDetailsTab }
  | { type: "updateNodeAgentLog"; payload: NodeAgentLogState }
  | { type: "updateNodeDetails"; payload: NodeDetailsUpdateMessage };

const FALLBACK_STATE: NodeDetailsState = {
  detailsAvailable: false,
  refreshFailed: false,
  environmentLabel: "Jenkins",
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
  offlineSinceMs: undefined,
  activityLabel: "Not available",
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
  hasLoaded: false,
  advancedRequested: false,
  activeTab: NODE_DETAILS_TABS.OVERVIEW,
  agentLog: emptyNodeAgentLogState()
};

function buildInitialState(initialState: NodeDetailsViewModel): NodeDetailsState {
  return {
    ...FALLBACK_STATE,
    ...initialState,
    loading: false,
    hasLoaded: true,
    advancedRequested: false
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
    case "selectTab":
      return { ...state, activeTab: action.tab };
    case "updateNodeAgentLog":
      return { ...state, agentLog: action.payload };
    case "advancedRequested":
      return state.advancedLoaded || state.advancedRequested
        ? state
        : { ...state, advancedRequested: true };
    case "updateNodeDetails":
      // Full updates rebuild from the view model, which clears
      // `advancedRequested`: the host has answered, loaded or failed.
      return {
        ...panelStateHelpers.handleFullUpdate(state, action.payload.payload),
        activeTab: state.activeTab,
        agentLog: state.agentLog
      };
    default:
      return state;
  }
}
export function getInitialState(): NodeDetailsState {
  const preferences = getVsCodeState<{ activeTab?: string; logFollowing?: boolean }>();
  return {
    ...panelStateHelpers.getInitialState(),
    activeTab:
      preferences?.activeTab && isNodeDetailsTab(preferences.activeTab)
        ? preferences.activeTab
        : NODE_DETAILS_TABS.OVERVIEW,
    agentLog: emptyNodeAgentLogState(
      typeof preferences?.logFollowing === "boolean" ? preferences.logFollowing : true
    )
  };
}

import {
  getVsCodeState,
  postVsCodeMessage,
  setVsCodeState
} from "../../../shared/webview/lib/vscodeApi";
import type { BuildDetailsIncomingMessage } from "../../shared/BuildDetailsPanelMessages";
import {
  type BuildDetailsPanelSerializedState,
  type BuildDetailsPanelUiState,
  isBuildDetailsPanelState,
  normalizeBuildDetailsPanelUiState,
  withBuildDetailsPanelUiState
} from "../../shared/BuildDetailsPanelWebviewState";

export function getBuildDetailsPanelUiState(): BuildDetailsPanelUiState {
  const state = getVsCodeState<BuildDetailsPanelSerializedState>();
  if (!isBuildDetailsPanelState(state)) {
    return {};
  }
  return normalizeBuildDetailsPanelUiState(state.buildDetailsUi) ?? {};
}

export function setBuildDetailsPanelUiState(uiState: BuildDetailsPanelUiState): void {
  const state = getVsCodeState<BuildDetailsPanelSerializedState>();
  if (!isBuildDetailsPanelState(state)) {
    return;
  }
  setVsCodeState(withBuildDetailsPanelUiState(state, uiState));
  const message: BuildDetailsIncomingMessage = {
    type: "persistUiState",
    uiState
  };
  postVsCodeMessage(message);
}

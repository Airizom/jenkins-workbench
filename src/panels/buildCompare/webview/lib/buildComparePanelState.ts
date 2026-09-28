import { isPlainRecord } from "../../../../shared/runtimeGuards";
import { getVsCodeState, setVsCodeState } from "../../../shared/webview/lib/vscodeApi";
import {
  type BuildComparePanelSerializedState,
  type BuildComparePanelUiState,
  normalizeBuildComparePanelUiState
} from "../../shared/BuildComparePanelWebviewState";

function readSavedState(): Record<string, unknown> {
  if (typeof window === "undefined") {
    return {};
  }
  const saved = getVsCodeState();
  return isPlainRecord(saved) ? saved : {};
}

export function readBuildCompareUiState(): BuildComparePanelUiState {
  return normalizeBuildComparePanelUiState(readSavedState().compareUi);
}

export function writeBuildCompareUiState(ui: BuildComparePanelUiState): void {
  setVsCodeState({ ...readSavedState(), compareUi: ui });
}

/**
 * Adopts the host's panel state after a refresh or swap (the build pair may
 * have changed) while keeping the webview-owned UI state.
 */
export function adoptHostPanelState(panelState: BuildComparePanelSerializedState): void {
  setVsCodeState({ ...panelState, compareUi: readBuildCompareUiState() });
}

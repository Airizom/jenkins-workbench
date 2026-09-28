import type { Dispatch } from "react";
import { usePanelMessages } from "../../../shared/webview/hooks/usePanelMessages";
import {
  type BuildCompareOutgoingMessage,
  parseBuildCompareOutgoingMessage
} from "../../shared/BuildComparePanelMessages";
import { adoptHostPanelState } from "../lib/buildComparePanelState";
import type { BuildCompareAction } from "../state/buildCompareState";

export function useBuildCompareMessages(dispatch: Dispatch<BuildCompareAction>): void {
  usePanelMessages(parseBuildCompareOutgoingMessage, dispatch, reduceBuildCompareMessage);
}

function reduceBuildCompareMessage(
  message: BuildCompareOutgoingMessage,
  dispatch: Dispatch<BuildCompareAction>
): void {
  switch (message.type) {
    case "updateConsoleSection":
      dispatch({ type: "updateConsoleSection", console: message.console });
      return;
    case "updateBuildCompare":
      adoptHostPanelState(message.panelState);
      dispatch({ type: "replaceComparison", model: message.model });
      return;
    case "buildCompareRefreshFailed":
      dispatch({ type: "actionFailed", message: message.message });
      return;
  }
}

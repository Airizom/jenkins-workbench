import type { Dispatch } from "react";
import { usePanelMessages } from "../../../shared/webview/hooks/usePanelMessages";
import { parseBuildCompareOutgoingMessage } from "../../shared/BuildComparePanelMessages";
import type { BuildCompareAction } from "../state/buildCompareState";
export function useBuildCompareMessages(dispatch: Dispatch<BuildCompareAction>): void {
  usePanelMessages(parseBuildCompareOutgoingMessage, dispatch, reduceBuildCompareMessage);
}

function reduceBuildCompareMessage(
  message: NonNullable<ReturnType<typeof parseBuildCompareOutgoingMessage>>,
  dispatch: Dispatch<BuildCompareAction>
): void {
  dispatch({
    type: "updateConsoleSection",
    console: message.console
  });
}

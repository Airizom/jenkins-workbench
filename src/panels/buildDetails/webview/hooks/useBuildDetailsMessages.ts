import type { Dispatch } from "react";
import { usePanelMessages } from "../../../shared/webview/hooks/usePanelMessages";
import { parseBuildDetailsOutgoingMessage } from "../../shared/BuildDetailsPanelMessages";
import type { BuildDetailsAction } from "../state/buildDetailsState";

export function useBuildDetailsMessages(dispatch: Dispatch<BuildDetailsAction>): void {
  usePanelMessages(parseBuildDetailsOutgoingMessage, dispatch, reduceBuildDetailsMessage);
}

function reduceBuildDetailsMessage(
  message: NonNullable<ReturnType<typeof parseBuildDetailsOutgoingMessage>>,
  dispatch: Dispatch<BuildDetailsAction>
): void {
  switch (message.type) {
    case "appendConsole":
      dispatch({ type: "appendConsole", text: message.text });
      break;
    case "appendConsoleHtml":
      dispatch({ type: "appendConsoleHtml", html: message.html });
      break;
    case "setConsole":
      dispatch({
        type: "setConsole",
        text: message.text,
        truncated: message.truncated
      });
      break;
    case "setConsoleHtml":
      dispatch({
        type: "setConsoleHtml",
        html: message.html,
        truncated: message.truncated
      });
      break;
    case "setPipelineNodeLog":
      dispatch({ type: "setPipelineNodeLog", log: message.log });
      break;
    case "appendPipelineNodeLogHtml":
      dispatch({
        type: "appendPipelineNodeLogHtml",
        targetKey: message.targetKey,
        html: message.html
      });
      break;
    case "setPipelineNodeLogLoading":
      dispatch({
        type: "setPipelineNodeLogLoading",
        targetKey: message.targetKey,
        loading: message.loading
      });
      break;
    case "setPipelineNodeLogError":
      dispatch({
        type: "setPipelineNodeLogError",
        targetKey: message.targetKey,
        error: message.error
      });
      break;
    case "updateDetails":
      dispatch({ type: "updateDetails", payload: message });
      break;
    case "setErrors":
      dispatch({
        type: "setErrors",
        errors: message.errors
      });
      break;
    case "setLoading":
      dispatch({ type: "setLoading", value: message.value });
      break;
    default:
      break;
  }
}

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
    case "appendConsoleHtml":
    case "setConsole":
    case "setConsoleHtml":
    case "setPipelineNodeLog":
    case "appendPipelineNodeLogHtml":
    case "setPipelineNodeLogLoading":
    case "setPipelineNodeLogError":
    case "setErrors":
    case "setBuildRelationships":
    case "setBuildNavigation":
    case "setBuildDiagnostics":
    case "pendingInputActionComplete":
    case "buildManagementActionComplete":
    case "setLoading":
      dispatch(message);
      break;
    case "updateDetails":
      dispatch({ type: "updateDetails", payload: message });
      break;
    default:
      break;
  }
}

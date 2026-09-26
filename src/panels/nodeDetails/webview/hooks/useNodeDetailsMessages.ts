import type { Dispatch } from "react";
import { usePanelMessages } from "../../../shared/webview/hooks/usePanelMessages";
import { toast } from "../../../shared/webview/hooks/useToast";
import { parseNodeDetailsOutgoingMessage } from "../../shared/NodeDetailsPanelMessages";
import type { NodeDetailsAction } from "../state/nodeDetailsState";
export function useNodeDetailsMessages(dispatch: Dispatch<NodeDetailsAction>): void {
  usePanelMessages(parseNodeDetailsOutgoingMessage, dispatch, reduceNodeDetailsMessage);
}

function reduceNodeDetailsMessage(
  message: NonNullable<ReturnType<typeof parseNodeDetailsOutgoingMessage>>,
  dispatch: Dispatch<NodeDetailsAction>
): void {
  switch (message.type) {
    case "setLoading":
      dispatch({ type: "setLoading", value: message.value });
      break;
    case "updateNodeDetails":
      dispatch({ type: "updateNodeDetails", payload: message });
      break;
    case "copyNodeJsonResult":
      if (message.success) {
        toast({
          title: "Copied",
          description: "Node JSON copied to clipboard.",
          variant: "success"
        });
      }
      break;
    default:
      break;
  }
}

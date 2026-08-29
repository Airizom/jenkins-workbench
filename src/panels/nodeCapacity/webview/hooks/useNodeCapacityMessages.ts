import type { Dispatch } from "react";
import { usePanelMessages } from "../../../shared/webview/hooks/usePanelMessages";
import {
  type NodeCapacityOutgoingMessage,
  parseNodeCapacityOutgoingMessage
} from "../../shared/NodeCapacityPanelMessages";
import type { NodeCapacityAction } from "../state/nodeCapacityState";
export function useNodeCapacityMessages(dispatch: Dispatch<NodeCapacityAction>): void {
  usePanelMessages(parseNodeCapacityOutgoingMessage, dispatch, dispatchNodeCapacityMessage);
}

function dispatchNodeCapacityMessage(
  message: NodeCapacityOutgoingMessage,
  dispatch: Dispatch<NodeCapacityAction>
): void {
  dispatch(message);
}

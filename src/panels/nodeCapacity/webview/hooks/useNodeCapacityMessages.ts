import type { Dispatch } from "react";
import { usePanelMessages } from "../../../shared/webview/hooks/usePanelMessages";
import {
  type NodeCapacityOutgoingMessage,
  parseNodeCapacityOutgoingMessage
} from "../../shared/NodeCapacityPanelMessages";
import type { NodeCapacityAction } from "../state/nodeCapacityState";
export function useNodeCapacityMessages(dispatch: Dispatch<NodeCapacityAction>): void {
  usePanelMessages(parseNodeCapacityOutgoingMessage, dispatch, mapMessageToAction);
}

function mapMessageToAction(
  message: NodeCapacityOutgoingMessage,
  dispatch: Dispatch<NodeCapacityAction>
): void {
  dispatch(mapNodeCapacityMessageToAction(message));
}

function mapNodeCapacityMessageToAction(message: NodeCapacityOutgoingMessage): NodeCapacityAction {
  switch (message.type) {
    case "updateNodeCapacity":
      return { type: "updateNodeCapacity", payload: message.payload };
    case "updateNodeCapacityNodeExecutors":
      return { type: "updateNodeCapacityNodeExecutors", payload: message.payload };
    case "setLoading":
      return { type: "setLoading", value: message.value };
  }
}

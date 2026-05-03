import * as React from "react";
import {
  type NodeCapacityOutgoingMessage,
  parseNodeCapacityOutgoingMessage
} from "../../shared/NodeCapacityPanelMessages";
import type { NodeCapacityAction } from "../state/nodeCapacityState";

export function useNodeCapacityMessages(dispatch: React.Dispatch<NodeCapacityAction>): void {
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = parseNodeCapacityOutgoingMessage(event.data);
      if (!message) {
        return;
      }
      dispatch(mapMessageToAction(message));
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dispatch]);
}

function mapMessageToAction(message: NodeCapacityOutgoingMessage): NodeCapacityAction {
  switch (message.type) {
    case "updateNodeCapacity":
      return { type: "updateNodeCapacity", payload: message.payload };
    case "updateNodeCapacityNodeExecutors":
      return { type: "updateNodeCapacityNodeExecutors", payload: message.payload };
    case "setLoading":
      return { type: "setLoading", value: message.value };
  }
}

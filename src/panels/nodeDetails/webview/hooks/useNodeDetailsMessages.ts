import { useEffect } from "react";
import type { Dispatch } from "react";
import { parseNodeDetailsOutgoingMessage } from "../../shared/NodeDetailsPanelMessages";
import type { NodeDetailsAction } from "../state/nodeDetailsState";

export function useNodeDetailsMessages(dispatch: Dispatch<NodeDetailsAction>): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = parseNodeDetailsOutgoingMessage(event.data);
      if (!message) {
        return;
      }
      switch (message.type) {
        case "setLoading":
          dispatch({ type: "setLoading", value: message.value });
          break;
        case "updateNodeDetails":
          dispatch({ type: "updateNodeDetails", payload: message });
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dispatch]);
}

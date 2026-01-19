import { useEffect } from "react";
import type { Dispatch } from "react";
import type { NodeDetailsAction, NodeDetailsIncomingMessage } from "../state/nodeDetailsState";

export function useNodeDetailsMessages(dispatch: Dispatch<NodeDetailsAction>): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as NodeDetailsIncomingMessage | null;
      if (!message || typeof message !== "object") {
        return;
      }
      switch (message.type) {
        case "setLoading":
          dispatch({ type: "setLoading", value: Boolean(message.value) });
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

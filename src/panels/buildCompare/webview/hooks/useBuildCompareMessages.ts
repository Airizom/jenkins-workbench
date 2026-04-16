import { useEffect } from "react";
import type { Dispatch } from "react";
import { parseBuildCompareOutgoingMessage } from "../../shared/BuildComparePanelMessages";
import type { BuildCompareAction } from "../state/buildCompareState";

export function useBuildCompareMessages(dispatch: Dispatch<BuildCompareAction>): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = parseBuildCompareOutgoingMessage(event.data);
      if (!message) {
        return;
      }
      switch (message.type) {
        case "updateConsoleSection":
          dispatch({
            type: "updateConsoleSection",
            console: message.console
          });
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dispatch]);
}

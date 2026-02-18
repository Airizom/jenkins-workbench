import { useEffect } from "react";
import type { Dispatch } from "react";
import { parseBuildDetailsOutgoingMessage } from "../../shared/BuildDetailsPanelMessages";
import type { BuildDetailsAction } from "../state/buildDetailsState";

export function useBuildDetailsMessages(dispatch: Dispatch<BuildDetailsAction>): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = parseBuildDetailsOutgoingMessage(event.data);
      if (!message) {
        return;
      }
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
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dispatch]);
}

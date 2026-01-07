import { useEffect } from "react";
import type { Dispatch } from "react";
import type {
  BuildDetailsAction,
  BuildDetailsIncomingMessage
} from "../state/buildDetailsState";

export function useBuildDetailsMessages(dispatch: Dispatch<BuildDetailsAction>): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as BuildDetailsIncomingMessage | null;
      if (!message || typeof message !== "object") {
        return;
      }
      switch (message.type) {
        case "appendConsole":
          if (typeof message.text === "string" && message.text.length > 0) {
            dispatch({ type: "appendConsole", text: message.text });
          }
          break;
        case "appendConsoleHtml":
          if (typeof message.html === "string" && message.html.length > 0) {
            dispatch({ type: "appendConsoleHtml", html: message.html });
          }
          break;
        case "setConsole":
          dispatch({
            type: "setConsole",
            text: typeof message.text === "string" ? message.text : "",
            truncated: Boolean(message.truncated)
          });
          break;
        case "setConsoleHtml":
          dispatch({
            type: "setConsoleHtml",
            html: typeof message.html === "string" ? message.html : "",
            truncated: Boolean(message.truncated)
          });
          break;
        case "updateDetails":
          dispatch({ type: "updateDetails", payload: message });
          break;
        case "setErrors":
          dispatch({
            type: "setErrors",
            errors: Array.isArray(message.errors) ? message.errors : []
          });
          break;
        case "setFollowLog":
          dispatch({ type: "setFollowLog", value: Boolean(message.value) });
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dispatch]);
}

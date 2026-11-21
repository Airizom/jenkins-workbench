import * as React from "react";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import { emptyHistory } from "../shared/HistoryContracts";
import { HistoryContext, historyReducer } from "./historyModel";

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const [model, dispatch] = React.useReducer(historyReducer, undefined, emptyHistory);
  React.useEffect(() => {
    const receive = (event: MessageEvent) => dispatch(event.data);
    window.addEventListener("message", receive);
    postVsCodeMessage({ type: "historyAction", action: "ready", revision: 0 });
    return () => window.removeEventListener("message", receive);
  }, []);
  return <HistoryContext.Provider value={model}>{children}</HistoryContext.Provider>;
}

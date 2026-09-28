import * as React from "react";
import { isPlainRecord } from "../../../shared/runtimeGuards";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import { emptyHistory, HISTORY_STATUSES, type HistoryViewModel } from "../shared/HistoryContracts";

export const HistoryContext = React.createContext<HistoryViewModel>(emptyHistory());
export function historyReducer(state: HistoryViewModel, value: unknown): HistoryViewModel {
  if (
    !isPlainRecord(value) ||
    value.type !== "historyUpdate" ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.revision !== "number" ||
    value.revision < state.revision ||
    typeof value.jobUrl !== "string" ||
    ![10, 20, 50].includes(Number(value.count)) ||
    !(HISTORY_STATUSES as readonly string[]).includes(String(value.status)) ||
    !Array.isArray(value.builds) ||
    !Array.isArray(value.tests) ||
    !isPlainRecord(value.evidence)
  )
    return state;
  return value as unknown as HistoryViewModel;
}
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

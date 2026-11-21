import * as React from "react";
import { isPlainRecord } from "../../../shared/runtimeGuards";
import {
  emptyHistory,
  HISTORY_STATUSES,
  type HistoryViewModel,
  isHistoryWindowSize
} from "../shared/HistoryContracts";

export const HistoryContext = React.createContext<HistoryViewModel>(emptyHistory());

export function historyReducer(state: HistoryViewModel, value: unknown): HistoryViewModel {
  if (
    !isPlainRecord(value) ||
    value.type !== "historyUpdate" ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.revision !== "number" ||
    value.revision < state.revision ||
    typeof value.jobUrl !== "string" ||
    !isHistoryWindowSize(value.count) ||
    !(HISTORY_STATUSES as readonly string[]).includes(String(value.status)) ||
    !Array.isArray(value.builds) ||
    !Array.isArray(value.tests) ||
    !isPlainRecord(value.evidence)
  )
    return state;
  return value as unknown as HistoryViewModel;
}

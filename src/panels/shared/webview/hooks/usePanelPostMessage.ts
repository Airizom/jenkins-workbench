import { useCallback } from "react";
import { postVsCodeMessage } from "../lib/vscodeApi";

export function usePanelPostMessage<T>(): (message: T) => void {
  return useCallback((message: T) => {
    postVsCodeMessage(message);
  }, []);
}

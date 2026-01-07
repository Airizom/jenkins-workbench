import { useCallback } from "react";
import { postVsCodeMessage } from "../lib/vscodeApi";

export type BuildDetailsPostMessage = (message: unknown) => void;

export function useBuildDetailsInteractions(): BuildDetailsPostMessage {
  const postMessage = useCallback((message: unknown) => {
    postVsCodeMessage(message);
  }, []);

  return postMessage;
}

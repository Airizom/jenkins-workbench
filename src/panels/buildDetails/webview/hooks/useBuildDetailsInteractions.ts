import { useCallback } from "react";
import { postVsCodeMessage } from "../../../shared/webview/lib/vscodeApi";
import type { BuildDetailsIncomingMessage } from "../../shared/BuildDetailsPanelMessages";

export type BuildDetailsPostMessage = (message: BuildDetailsIncomingMessage) => void;

export function useBuildDetailsInteractions(): BuildDetailsPostMessage {
  const postMessage = useCallback((message: BuildDetailsIncomingMessage) => {
    postVsCodeMessage(message);
  }, []);

  return postMessage;
}

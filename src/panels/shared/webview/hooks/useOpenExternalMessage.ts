import { useCallback } from "react";

export type OpenExternalPanelMessage = { type: "openExternal"; url: string };
export function useOpenExternalMessage(
  postMessage: (message: OpenExternalPanelMessage) => void
): (url: string) => void {
  return useCallback(
    (url: string) => {
      if (!url) {
        return;
      }
      postMessage({ type: "openExternal", url });
    },
    [postMessage]
  );
}

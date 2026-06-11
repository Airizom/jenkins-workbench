import { useEffect } from "react";
export function usePanelMessages<TMessage, TDispatch>(
  parseMessage: (data: unknown) => TMessage | undefined,
  dispatch: TDispatch,
  reduceMessage: (message: TMessage, dispatch: TDispatch) => void
): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = parseMessage(event.data);
      if (!message) {
        return;
      }
      reduceMessage(message, dispatch);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dispatch, parseMessage, reduceMessage]);
}

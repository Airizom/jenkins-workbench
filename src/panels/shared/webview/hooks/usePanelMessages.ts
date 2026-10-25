import { useEffect } from "react";

/** Default handler: parsed messages are already reducer actions. */
function forwardToDispatch<TMessage>(message: TMessage, dispatch: (message: TMessage) => void) {
  dispatch(message);
}

export function usePanelMessages<TMessage>(
  parseMessage: (data: unknown) => TMessage | undefined,
  dispatch: (message: TMessage) => void
): void;
export function usePanelMessages<TMessage, TDispatch>(
  parseMessage: (data: unknown) => TMessage | undefined,
  dispatch: TDispatch,
  reduceMessage: (message: TMessage, dispatch: TDispatch) => void
): void;
export function usePanelMessages<TMessage, TDispatch>(
  parseMessage: (data: unknown) => TMessage | undefined,
  dispatch: TDispatch,
  reduceMessage: (message: TMessage, dispatch: TDispatch) => void = forwardToDispatch as (
    message: TMessage,
    dispatch: TDispatch
  ) => void
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

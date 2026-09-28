import type { Dispatch } from "react";
import * as React from "react";
import type { BuildDetailsIncomingMessage } from "../../shared/BuildDetailsPanelMessages";
import type { BuildDetailsAction, PendingInputProcessingAction } from "../state/buildDetailsState";

const { useCallback, useEffect, useRef } = React;

/**
 * Fallback only: the extension replies with `pendingInputActionComplete` once the
 * request settles. This covers a lost reply without re-enabling the buttons while a
 * parameter prompt or confirmation dialog is plausibly still open.
 */
const PENDING_INPUT_ACTION_SAFETY_TIMEOUT_MS = 60_000;

export function usePendingInputActions(
  dispatch: Dispatch<BuildDetailsAction>,
  postMessage: (message: BuildDetailsIncomingMessage) => void,
  processingInputActions: Record<string, PendingInputProcessingAction>
): (inputId: string, action: PendingInputProcessingAction) => void {
  const timers = useRef(new Map<string, number>());

  // Clear fallback timers once the extension has confirmed completion.
  useEffect(() => {
    for (const [inputId, timeoutId] of timers.current) {
      if (!processingInputActions[inputId]) {
        window.clearTimeout(timeoutId);
        timers.current.delete(inputId);
      }
    }
  }, [processingInputActions]);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timeoutId of activeTimers.values()) {
        window.clearTimeout(timeoutId);
      }
      activeTimers.clear();
    };
  }, []);

  return useCallback(
    (inputId: string, action: PendingInputProcessingAction) => {
      if (timers.current.has(inputId)) {
        return;
      }
      dispatch({ type: "startPendingInputAction", inputId, action });
      timers.current.set(
        inputId,
        window.setTimeout(() => {
          timers.current.delete(inputId);
          dispatch({ type: "pendingInputActionComplete", inputId });
        }, PENDING_INPUT_ACTION_SAFETY_TIMEOUT_MS)
      );
      postMessage(
        action === "approve" ? { type: "approveInput", inputId } : { type: "rejectInput", inputId }
      );
    },
    [dispatch, postMessage]
  );
}

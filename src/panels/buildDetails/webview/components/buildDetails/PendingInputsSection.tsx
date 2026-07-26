import * as React from "react";
import { ResultBadge } from "../../../../shared/webview/components/ResultBadge";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  AlertCircleIcon,
  CheckIcon,
  RefreshIcon,
  UserIcon,
  XIcon
} from "../../../../shared/webview/icons";
import type { PendingInputViewModel } from "../../../shared/BuildDetailsContracts";

const { useEffect, useRef, useState } = React;

const PROCESSING_TIMEOUT_MS = 5000;
type ProcessingAction = "approve" | "reject";
const ACTION_LABELS: Record<ProcessingAction, string> = {
  approve: "Approve",
  reject: "Reject"
};
const PROCESSING_LABELS: Record<ProcessingAction, string> = {
  approve: "Approving...",
  reject: "Rejecting..."
};

export function PendingInputsSection({
  pendingInputs,
  onApprove,
  onReject
}: {
  pendingInputs: PendingInputViewModel[];
  onApprove: (inputId: string) => void;
  onReject: (inputId: string) => void;
}) {
  const [processingActions, setProcessingActions] = useState<Record<string, ProcessingAction>>({});
  const processingTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    setProcessingActions((prev) => {
      const next: Record<string, ProcessingAction> = {};
      for (const input of pendingInputs) {
        const action = prev[input.id];
        if (action) {
          next[input.id] = action;
        }
      }
      return next;
    });

    const activeIds = new Set(pendingInputs.map((input) => input.id));
    for (const id of Object.keys(processingTimers.current)) {
      if (!activeIds.has(id)) {
        window.clearTimeout(processingTimers.current[id]);
        delete processingTimers.current[id];
      }
    }
  }, [pendingInputs]);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(processingTimers.current)) {
        window.clearTimeout(timeoutId);
      }
      processingTimers.current = {};
    };
  }, []);

  const markProcessing = (inputId: string, action: ProcessingAction) => {
    setProcessingActions((prev) => ({ ...prev, [inputId]: action }));
    if (processingTimers.current[inputId]) {
      window.clearTimeout(processingTimers.current[inputId]);
    }
    processingTimers.current[inputId] = window.setTimeout(() => {
      setProcessingActions((prev) => {
        if (!prev[inputId]) {
          return prev;
        }
        const { [inputId]: _, ...rest } = prev;
        return rest;
      });
      delete processingTimers.current[inputId];
    }, PROCESSING_TIMEOUT_MS);
  };

  const handleInputAction = (inputId: string, action: ProcessingAction) => {
    if (processingActions[inputId]) {
      return;
    }
    markProcessing(inputId, action);
    if (action === "approve") {
      onApprove(inputId);
    } else {
      onReject(inputId);
    }
  };

  if (pendingInputs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {pendingInputs.map((input) => {
        const processingAction = processingActions[input.id];
        const handleAction = (action: ProcessingAction) => handleInputAction(input.id, action);

        return (
          <div
            key={input.id}
            className="rounded border border-warning-border overflow-hidden"
            aria-busy={Boolean(processingAction)}
          >
            <div className="flex items-center justify-between gap-2 bg-warning-surface px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircleIcon className="h-4 w-4" />
                <span className="text-xs font-medium truncate">{input.message}</span>
                {input.submitterLabel ? (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                    <UserIcon className="h-3.5 w-3.5" />
                    {input.submitterLabel}
                  </span>
                ) : null}
              </div>
              <ResultBadge label="Pending" status="running" className="text-[11px] shrink-0" />
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-card">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {input.parameters.length > 0 ? (
                  <>
                    {input.parameters.map((param) => (
                      <Badge
                        key={`${input.id}-${param.name}`}
                        variant="secondary"
                        className="font-mono text-[11px] px-1.5 py-0"
                      >
                        {param.name}
                      </Badge>
                    ))}
                    {input.parametersLabel ? (
                      <span className="text-[11px] text-muted-foreground truncate">
                        {input.parametersLabel}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <PendingInputActionButton
                  action="approve"
                  processingAction={processingAction}
                  onAction={handleAction}
                />
                <PendingInputActionButton
                  action="reject"
                  processingAction={processingAction}
                  onAction={handleAction}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PendingInputActionButton({
  action,
  processingAction,
  onAction
}: {
  action: ProcessingAction;
  processingAction?: ProcessingAction;
  onAction: (action: ProcessingAction) => void;
}): React.JSX.Element {
  const isProcessing = processingAction === action;
  const ActionIcon = action === "approve" ? CheckIcon : XIcon;

  return (
    <Button
      variant={action === "approve" ? "default" : "outline"}
      size="sm"
      onClick={() => onAction(action)}
      className="gap-1 h-6 px-2 text-[11px]"
      disabled={Boolean(processingAction)}
    >
      {isProcessing ? (
        <RefreshIcon className="h-4 w-4 animate-spin" />
      ) : (
        <ActionIcon className="h-4 w-4" />
      )}
      {isProcessing ? PROCESSING_LABELS[action] : ACTION_LABELS[action]}
    </Button>
  );
}

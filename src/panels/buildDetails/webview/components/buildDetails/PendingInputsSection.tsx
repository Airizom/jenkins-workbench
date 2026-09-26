import * as React from "react";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  AlertCircleIcon,
  CheckIcon,
  RefreshIcon,
  UserIcon,
  XIcon
} from "../../../../shared/webview/icons";
import type {
  PendingInputParameterViewModel,
  PendingInputViewModel
} from "../../../shared/BuildDetailsContracts";

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
            <div className="flex items-start justify-between gap-3 bg-warning-surface px-3 py-2.5">
              <div className="flex min-w-0 items-start gap-2">
                <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium wrap-break-word">{input.message}</div>
                  {input.submitterLabel ? (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <UserIcon className="h-3 w-3" />
                      <span className="truncate">{input.submitterLabel}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
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

            {input.parameters.length > 0 ? (
              <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-warning-border bg-card px-3 py-2.5 text-[11px]">
                {input.parameters.map((param) => (
                  <React.Fragment key={`${input.id}-${param.name}`}>
                    <dt className="flex items-center gap-1.5">
                      <span className="font-mono font-medium truncate">{param.name}</span>
                      <Badge variant="secondary" size="sm">
                        {param.kind}
                      </Badge>
                    </dt>
                    <dd className="m-0 min-w-0 text-muted-foreground wrap-break-word">
                      {describePendingInputParameter(param)}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : null}
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
      disabled={Boolean(processingAction)}
    >
      {isProcessing ? (
        <RefreshIcon className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ActionIcon className="h-3.5 w-3.5" />
      )}
      {isProcessing ? PROCESSING_LABELS[action] : ACTION_LABELS[action]}
    </Button>
  );
}

export function describePendingInputParameter(param: PendingInputParameterViewModel): string {
  const parts: string[] = [];
  if (param.description) {
    parts.push(param.description);
  }
  if (param.choices && param.choices.length > 0) {
    parts.push(`Choices: ${param.choices.join(", ")}`);
  }
  const defaultLabel = formatDefaultValue(param.defaultValue);
  if (defaultLabel) {
    parts.push(`Default: ${defaultLabel}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "You will be prompted for a value.";
}

function formatDefaultValue(value: PendingInputParameterViewModel["defaultValue"]): string {
  if (value === undefined || value === "") {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

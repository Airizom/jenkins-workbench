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
import type { PendingInputProcessingAction } from "../../state/buildDetailsState";

type ProcessingAction = PendingInputProcessingAction;
const ACTION_LABELS: Record<ProcessingAction, string> = {
  approve: "Approve",
  reject: "Reject"
};
const PROCESSING_LABELS: Record<ProcessingAction, string> = {
  approve: "Approving…",
  reject: "Rejecting…"
};
const ACTION_TITLES: Record<ProcessingAction, string> = {
  approve: "Approve this input and let the build continue",
  reject: "Reject this input and abort the build"
};
const NO_PROCESSING_ACTIONS: Record<string, ProcessingAction> = {};

export function PendingInputsSection({
  pendingInputs,
  processingActions = NO_PROCESSING_ACTIONS,
  onApprove,
  onReject
}: {
  pendingInputs: PendingInputViewModel[];
  /** Requests still being handled by the extension; their buttons stay disabled. */
  processingActions?: Record<string, ProcessingAction>;
  onApprove: (inputId: string) => void;
  onReject: (inputId: string) => void;
}) {
  const handleInputAction = (inputId: string, action: ProcessingAction) => {
    if (processingActions[inputId]) {
      return;
    }
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
                    <div className="flex items-center gap-1 text-caption text-muted-foreground">
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
              <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-warning-border bg-card px-3 py-2.5 text-caption">
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
      title={ACTION_TITLES[action]}
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

import * as React from "react";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  AlertCircleIcon,
  CheckIcon,
  ExternalLinkIcon,
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
// Inputs with parameters open VS Code prompts for their values before
// approving, so the button takes an ellipsis per the platform convention.
const PROMPTED_APPROVE_LABEL = "Approve…";
const PROMPTED_APPROVE_TITLE = "Choose parameter values, then approve and let the build continue";
// Some parameter types can only be entered on the Jenkins input page, so
// approval moves there; Reject still runs from VS Code.
const BROWSER_APPROVE_LABEL = "Approve in Jenkins";
const BROWSER_APPROVE_TITLE = "Open the Jenkins input page to enter these values and approve";
const NO_PROCESSING_ACTIONS: Record<string, ProcessingAction> = {};

export function PendingInputsSection({
  pendingInputs,
  processingActions = NO_PROCESSING_ACTIONS,
  onApprove,
  onReject,
  onOpenInJenkins
}: {
  pendingInputs: PendingInputViewModel[];
  /** Requests still being handled by the extension; their buttons stay disabled. */
  processingActions?: Record<string, ProcessingAction>;
  onApprove: (inputId: string) => void;
  onReject: (inputId: string) => void;
  onOpenInJenkins: (inputId: string) => void;
}) {
  const getProcessingAction = (inputId: string) =>
    Object.hasOwn(processingActions, inputId) ? processingActions[inputId] : undefined;
  const handleInputAction = (inputId: string, action: ProcessingAction) => {
    if (getProcessingAction(inputId)) {
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
        const processingAction = getProcessingAction(input.id);
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
                {input.requiresBrowser ? (
                  <Button
                    variant="default"
                    size="sm"
                    // Opening a page has no completion reply, so it skips processingActions.
                    onClick={() => onOpenInJenkins(input.id)}
                    disabled={Boolean(processingAction)}
                    title={BROWSER_APPROVE_TITLE}
                  >
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                    {BROWSER_APPROVE_LABEL}
                  </Button>
                ) : (
                  <PendingInputActionButton
                    action="approve"
                    processingAction={processingAction}
                    promptsForValues={input.parameters.length > 0}
                    onAction={handleAction}
                  />
                )}
                <PendingInputActionButton
                  action="reject"
                  processingAction={processingAction}
                  onAction={handleAction}
                />
              </div>
            </div>

            {input.parameters.length > 0 ? (
              <div className="border-t border-warning-border bg-card px-3 py-2.5 text-caption">
                <p className="m-0 mb-2 text-muted-foreground">
                  {describePendingInputParametersNote(input)}
                </p>
                <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                  {input.parameters.map((param) => (
                    <React.Fragment key={`${input.id}-${param.name}`}>
                      <dt className="flex items-center gap-1.5">
                        <span className="font-mono font-medium truncate">{param.name}</span>
                        <Badge variant="secondary" size="sm">
                          {param.kind}
                        </Badge>
                        {param.requiresBrowser ? (
                          <Badge variant="info" size="sm">
                            Browser
                          </Badge>
                        ) : null}
                      </dt>
                      <dd className="m-0 min-w-0 text-muted-foreground wrap-break-word">
                        {describePendingInputParameter(param)}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
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
  promptsForValues = false,
  onAction
}: {
  action: ProcessingAction;
  processingAction?: ProcessingAction;
  promptsForValues?: boolean;
  onAction: (action: ProcessingAction) => void;
}): React.JSX.Element {
  const isProcessing = processingAction === action;
  const ActionIcon = action === "approve" ? CheckIcon : XIcon;
  const prompted = action === "approve" && promptsForValues;

  return (
    <Button
      variant={action === "approve" ? "default" : "outline"}
      size="sm"
      onClick={() => onAction(action)}
      disabled={Boolean(processingAction)}
      title={prompted ? PROMPTED_APPROVE_TITLE : ACTION_TITLES[action]}
    >
      {isProcessing ? (
        <RefreshIcon className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ActionIcon className="h-3.5 w-3.5" />
      )}
      {isProcessing
        ? PROCESSING_LABELS[action]
        : prompted
          ? PROMPTED_APPROVE_LABEL
          : ACTION_LABELS[action]}
    </Button>
  );
}

function describePendingInputParametersNote(input: PendingInputViewModel): string {
  if (!input.requiresBrowser) {
    return "You choose these values when you approve.";
  }
  const names = input.parameters
    .filter((param) => param.requiresBrowser)
    .map((param) => param.name)
    .join(", ");
  return `Approve this input in Jenkins: ${names} can't be entered in VS Code.`;
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
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return param.requiresBrowser
    ? "Entered on the Jenkins input page."
    : "You will be prompted for a value.";
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

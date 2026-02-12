import * as React from "react";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import type { PendingInputViewModel } from "../../../shared/BuildDetailsContracts";
import { StatusPill } from "./StatusPill";

const { useEffect, useRef, useState } = React;

const PROCESSING_TIMEOUT_MS = 5000;

function AlertCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-warning"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function PendingInputsSection({
  pendingInputs,
  onApprove,
  onReject
}: {
  pendingInputs: PendingInputViewModel[];
  onApprove: (inputId: string) => void;
  onReject: (inputId: string) => void;
}) {
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});
  const [processingActions, setProcessingActions] = useState<
    Record<string, "approve" | "reject">
  >({});
  const processingTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    setProcessingIds((prev) => {
      const next: Record<string, boolean> = {};
      for (const input of pendingInputs) {
        if (prev[input.id]) {
          next[input.id] = true;
        }
      }
      return next;
    });
    setProcessingActions((prev) => {
      const next: Record<string, "approve" | "reject"> = {};
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

  const markProcessing = (inputId: string, action: "approve" | "reject") => {
    setProcessingIds((prev) => ({ ...prev, [inputId]: true }));
    setProcessingActions((prev) => ({ ...prev, [inputId]: action }));
    if (processingTimers.current[inputId]) {
      window.clearTimeout(processingTimers.current[inputId]);
    }
    processingTimers.current[inputId] = window.setTimeout(() => {
      setProcessingIds((prev) => {
        if (!prev[inputId]) {
          return prev;
        }
        const { [inputId]: _, ...rest } = prev;
        return rest;
      });
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

  if (pendingInputs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {pendingInputs.map((input) => (
        <div
          key={input.id}
          className="rounded border border-warning-border overflow-hidden"
          aria-busy={Boolean(processingIds[input.id])}
        >
          <div className="flex items-center justify-between gap-2 bg-warning-surface px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircleIcon />
              <span className="text-xs font-medium truncate">{input.message}</span>
              {input.submitterLabel ? (
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                  <UserIcon />
                  {input.submitterLabel}
                </span>
              ) : null}
            </div>
            <StatusPill label="Pending" status="running" className="text-[10px] shrink-0" />
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-card">
            <div className="flex items-center gap-1.5 min-w-0">
              {input.parameters.length > 0 ? (
                <>
                  {input.parameters.map((param) => (
                    <Badge
                      key={`${input.id}-${param.name}`}
                      variant="secondary"
                      className="font-mono text-[10px] px-1.5 py-0"
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
              <Button
                size="sm"
                onClick={() => {
                  if (processingIds[input.id]) {
                    return;
                  }
                  markProcessing(input.id, "approve");
                  onApprove(input.id);
                }}
                className="gap-1 h-6 px-2 text-[11px]"
                disabled={Boolean(processingIds[input.id])}
              >
                <CheckIcon />
                {processingActions[input.id] === "approve" ? "..." : "Approve"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (processingIds[input.id]) {
                    return;
                  }
                  markProcessing(input.id, "reject");
                  onReject(input.id);
                }}
                className="gap-1 h-6 px-2 text-[11px]"
                disabled={Boolean(processingIds[input.id])}
              >
                <XIcon />
                {processingActions[input.id] === "reject" ? "..." : "Reject"}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

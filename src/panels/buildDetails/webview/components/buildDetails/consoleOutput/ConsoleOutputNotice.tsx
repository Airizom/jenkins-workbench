import type * as React from "react";
import { Alert, AlertDescription } from "../../../../../shared/webview/components/ui/alert";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { AlertCircleIcon } from "../../../../../shared/webview/icons";

type ConsoleOutputNoticeProps = {
  note: string;
  id?: string;
};

type ConsoleOutputErrorNoticeProps = {
  error?: string;
  id?: string;
  onRetry?: () => void;
};

export function ConsoleOutputTruncationNotice({
  note,
  id
}: ConsoleOutputNoticeProps): React.JSX.Element | null {
  if (!note) {
    return null;
  }
  return (
    <div
      id={id}
      className="flex items-center gap-1.5 rounded border border-warning-border bg-warning-surface px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
      {note}
    </div>
  );
}

export function ConsoleOutputErrorNotice({
  error,
  id,
  onRetry
}: ConsoleOutputErrorNoticeProps): React.JSX.Element | null {
  if (!error) {
    return null;
  }
  return (
    <Alert id={id} variant="warning" className="py-2">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="min-w-0">{error}</span>
        {onRetry ? (
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

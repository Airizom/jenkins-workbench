import { Alert, AlertDescription } from "../../../../../shared/webview/components/ui/alert";
import { AlertCircleIcon } from "../../../../../shared/webview/icons";

type ConsoleOutputNoticeProps = {
  note: string;
};

type ConsoleOutputErrorNoticeProps = {
  error?: string;
};

export function ConsoleOutputTruncationNotice({
  note
}: ConsoleOutputNoticeProps): JSX.Element | null {
  if (!note) {
    return null;
  }
  return (
    <div
      id="console-note"
      className="flex items-center gap-1.5 rounded border border-warning-border bg-warning-surface px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
      {note}
    </div>
  );
}

export function ConsoleOutputErrorNotice({
  error
}: ConsoleOutputErrorNoticeProps): JSX.Element | null {
  if (!error) {
    return null;
  }
  return (
    <Alert id="console-error" variant="warning" className="py-2">
      <AlertDescription className="text-xs">{error}</AlertDescription>
    </Alert>
  );
}

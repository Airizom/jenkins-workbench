import { Alert, AlertDescription } from "../../../../../shared/webview/components/ui/alert";

type ConsoleOutputNoticeProps = {
  note: string;
};

type ConsoleOutputErrorNoticeProps = {
  error?: string;
};

function ConsoleOutputAlertIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function ConsoleOutputTruncationNotice({ note }: ConsoleOutputNoticeProps): JSX.Element | null {
  if (!note) {
    return null;
  }
  return (
    <div
      id="console-note"
      className="flex items-center gap-1.5 rounded border border-warning-border bg-warning-surface px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      <ConsoleOutputAlertIcon />
      {note}
    </div>
  );
}

export function ConsoleOutputErrorNotice({ error }: ConsoleOutputErrorNoticeProps): JSX.Element | null {
  if (!error) {
    return null;
  }
  return (
    <Alert id="console-error" variant="warning" className="py-2">
      <AlertDescription className="text-xs">{error}</AlertDescription>
    </Alert>
  );
}

import { cn } from "../../../../../shared/webview/lib/utils";

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
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
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" className="h-3 w-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

export function getStageIcon(statusClass?: string) {
  switch (statusClass) {
    case "success":
      return <CheckIcon />;
    case "failure":
      return <XIcon />;
    case "unstable":
      return <AlertIcon />;
    case "running":
      return <PlayIcon />;
    case "aborted":
      return <StopIcon />;
    default:
      return null;
  }
}

export function getStageNodeStyle(statusClass?: string): string {
  const baseStyles =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors";
  switch (statusClass) {
    case "success":
      return cn(baseStyles, "border-success-border bg-success-soft text-success");
    case "failure":
      return cn(baseStyles, "border-failure-border bg-failure-soft text-failure");
    case "unstable":
      return cn(baseStyles, "border-warning-border bg-warning-soft text-warning");
    case "running":
      return cn(baseStyles, "border-warning-border bg-warning-soft text-warning animate-pulse");
    case "aborted":
      return cn(baseStyles, "border-aborted-border bg-aborted-soft text-aborted");
    default:
      return cn(baseStyles, "border-border bg-muted text-muted-foreground");
  }
}

export function getConnectorColor(statusClass?: string): string {
  switch (statusClass) {
    case "success":
      return "var(--success)";
    case "failure":
      return "var(--failure)";
    case "unstable":
      return "var(--warning)";
    case "running":
      return "var(--warning)";
    case "aborted":
      return "var(--aborted)";
    default:
      return "var(--border)";
  }
}

import {
  AlertTriangleIcon,
  CheckIcon,
  PlayIcon,
  StopSquareIcon,
  XIcon
} from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";

export function getStageIcon(statusClass?: string) {
  switch (statusClass) {
    case "success":
      return <CheckIcon className="h-3 w-3" />;
    case "failure":
      return <XIcon className="h-3 w-3" />;
    case "unstable":
      return <AlertTriangleIcon className="h-3 w-3 text-current" />;
    case "running":
      return <PlayIcon className="h-3 w-3 ml-0.5 text-current" />;
    case "aborted":
      return <StopSquareIcon className="h-3 w-3 text-current" />;
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

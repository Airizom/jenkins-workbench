import {
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  AlertTriangleIcon,
  PlayCircleIcon,
  StopCircleIcon,
  UserIcon,
  XCircleIcon
} from "../../../../shared/webview/icons";
import { StatusPill } from "./StatusPill";

function getStatusIcon(resultClass?: string) {
  switch (resultClass) {
    case "success":
      return <CheckCircleIcon className="h-4 w-4" />;
    case "failure":
      return <XCircleIcon className="h-4 w-4" />;
    case "unstable":
      return <AlertTriangleIcon className="h-4 w-4" />;
    case "running":
      return <PlayCircleIcon className="h-4 w-4" />;
    case "aborted":
      return <StopCircleIcon className="h-4 w-4" />;
    default:
      return null;
  }
}

export function BuildSummaryCard({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel
}: {
  displayName: string;
  resultLabel: string;
  resultClass?: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
}) {
  const statusIcon = getStatusIcon(resultClass);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-border bg-muted-soft px-3 py-2.5">
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="text-xs font-semibold">{displayName}</span>
        <StatusPill label={resultLabel} status={resultClass} className="text-[10px]" />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="h-3 w-3" />
          {durationLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarIcon className="h-3 w-3" />
          {timestampLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <UserIcon className="h-3 w-3" />
          {culpritsLabel}
        </span>
      </div>
    </div>
  );
}

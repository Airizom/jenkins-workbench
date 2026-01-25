import { Card, CardContent } from "../../../../shared/webview/components/ui/card";
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  PlayCircleIcon,
  StopCircleIcon,
  UserIcon,
  XCircleIcon
} from "../../../../shared/webview/icons";
import { StatusPill } from "./StatusPill";

function getStatusIcon(resultClass?: string) {
  switch (resultClass) {
    case "success":
      return <CheckCircleIcon />;
    case "failure":
      return <XCircleIcon />;
    case "unstable":
      return <AlertTriangleIcon />;
    case "running":
      return <PlayCircleIcon />;
    case "aborted":
      return <StopCircleIcon />;
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
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div className="flex items-center gap-4 border-b border-border p-4 md:border-b-0 md:border-r md:p-6">
            {statusIcon}
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">{displayName}</div>
              <StatusPill label={resultLabel} status={resultClass} />
            </div>
          </div>

          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <ClockIcon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex flex-col">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Duration
                </div>
                <div className="text-sm font-medium">{durationLabel}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex flex-col">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Timestamp
                </div>
                <div className="text-sm font-medium">{timestampLabel}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <UserIcon />
              </div>
              <div className="flex flex-col">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Culprit(s)
                </div>
                <div className="text-sm font-medium">{culpritsLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

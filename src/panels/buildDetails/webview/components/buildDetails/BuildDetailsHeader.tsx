import { Button } from "../../../../shared/webview/components/ui/button";
import { Progress } from "../../../../shared/webview/components/ui/progress";
import { StatusPill } from "./StatusPill";
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  PlayCircleIcon,
  StopCircleIcon,
  UserIcon,
  XCircleIcon
} from "../../../../shared/webview/icons";
import { cn } from "../../../../shared/webview/lib/utils";

type BuildDetailsHeaderProps = {
  displayName: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  loading: boolean;
  isRunning: boolean;
  buildUrl?: string;
  onOpenBuild: () => void;
};

const STATUS_ACCENT: Record<string, string> = {
  success: "bg-success",
  failure: "bg-failure",
  unstable: "bg-warning",
  aborted: "bg-aborted",
  running: "bg-warning",
  neutral: "bg-border"
};

function getStatusAccent(status: string): string {
  return STATUS_ACCENT[status] ?? STATUS_ACCENT.neutral;
}

function HeaderStatusIcon({ status }: { status: string }) {
  const size = "h-4 w-4";
  switch (status) {
    case "success":
      return <CheckCircleIcon className={size} />;
    case "failure":
      return <XCircleIcon className={size} />;
    case "unstable":
      return <AlertTriangleIcon className={size} />;
    case "aborted":
      return <StopCircleIcon className={size} />;
    case "running":
      return <PlayCircleIcon className={size} />;
    default:
      return null;
  }
}

export function BuildDetailsHeader({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel,
  loading,
  isRunning,
  buildUrl,
  onOpenBuild
}: BuildDetailsHeaderProps): JSX.Element {
  return (
    <header className="sticky-header">
      {isRunning || loading ? <Progress indeterminate className="h-px rounded-none" /> : null}
      <div className="mx-auto max-w-6xl px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <HeaderStatusIcon status={resultClass} />
            <h1 className="text-sm font-semibold leading-tight truncate" id="detail-title">
              {displayName}
            </h1>
            <StatusPill id="detail-result" label={resultLabel} status={resultClass} />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1" id="detail-duration">
                <ClockIcon className="h-3 w-3" />
                {durationLabel}
              </span>
              <span aria-hidden="true" className="opacity-30">
                |
              </span>
              <span className="inline-flex items-center gap-1" id="detail-timestamp">
                <CalendarIcon className="h-3 w-3" />
                {timestampLabel}
              </span>
              {culpritsLabel !== "—" && culpritsLabel !== "None" ? (
                <>
                  <span aria-hidden="true" className="opacity-30">
                    |
                  </span>
                  <span className="inline-flex items-center gap-1" id="detail-culprits">
                    <UserIcon className="h-3 w-3" />
                    {culpritsLabel}
                  </span>
                </>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenBuild}
              disabled={!buildUrl}
              aria-label="Open in Jenkins"
              className="gap-1 h-7 px-2 text-xs"
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Jenkins</span>
            </Button>
          </div>
        </div>
        <div className="sm:hidden flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" id="detail-duration-sm">
            <ClockIcon className="h-3 w-3" />
            {durationLabel}
          </span>
          <span aria-hidden="true" className="opacity-30">
            |
          </span>
          <span className="inline-flex items-center gap-1" id="detail-timestamp-sm">
            <CalendarIcon className="h-3 w-3" />
            {timestampLabel}
          </span>
          {culpritsLabel !== "—" && culpritsLabel !== "None" ? (
            <>
              <span aria-hidden="true" className="opacity-30">
                |
              </span>
              <span className="inline-flex items-center gap-1" id="detail-culprits-sm">
                <UserIcon className="h-3 w-3" />
                {culpritsLabel}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className={cn("h-px", getStatusAccent(resultClass))} />
    </header>
  );
}

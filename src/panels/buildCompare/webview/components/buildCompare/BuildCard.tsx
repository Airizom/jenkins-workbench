import { ResultBadge } from "../../../../shared/webview/components/ResultBadge";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../../shared/webview/components/ui/card";
import { postVsCodeMessage } from "../../../../shared/webview/lib/vscodeApi";
import type { BuildCompareBuildViewModel } from "../../../shared/BuildCompareContracts";
import { SummaryStat } from "./shared/SummaryStat";

export function BuildCard({
  build,
  side,
  showJob
}: {
  build: BuildCompareBuildViewModel;
  side: "baseline" | "target";
  /** Set when the two builds come from different jobs. */
  showJob: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {build.roleLabel}
            </p>
            <CardTitle className="flex min-w-0 items-baseline gap-1.5" title={build.displayName}>
              {showJob && build.jobDisplayName ? (
                <span className="min-w-0 truncate">{build.jobDisplayName}</span>
              ) : null}
              <span className="shrink-0 tabular-nums">{build.buildNumberLabel}</span>
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <ResultBadge resultClass={build.resultClass} label={build.resultLabel} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => postVsCodeMessage({ type: "openBuildDetails", side })}
            >
              Open Build Details
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryStat label="Duration" value={build.durationLabel} />
          <SummaryStat label="Completed" value={build.timestampLabel} />
        </div>
      </CardContent>
    </Card>
  );
}

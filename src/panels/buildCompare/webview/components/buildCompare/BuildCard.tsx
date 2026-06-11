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
  side
}: {
  build: BuildCompareBuildViewModel;
  side: "baseline" | "target";
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {build.roleLabel}
            </p>
            <CardTitle className="truncate">{build.displayName}</CardTitle>
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SummaryStat label="Duration" value={build.durationLabel} />
          <SummaryStat label="Completed" value={build.timestampLabel} />
          <SummaryStat label="Result" value={build.resultLabel} />
        </div>
      </CardContent>
    </Card>
  );
}

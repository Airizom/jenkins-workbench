import { ResultBadge } from "../../../../shared/webview/components/ResultBadge";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Card } from "../../../../shared/webview/components/ui/card";
import { postVsCodeMessage } from "../../../../shared/webview/lib/vscodeApi";
import type { BuildCompareBuildViewModel } from "../../../shared/BuildCompareContracts";

/**
 * Compact identity card: role, build, result, and timing fit in two short
 * rows so the diffs below start near the top of the panel.
 */
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
    <Card className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium uppercase tracking-wider text-muted-foreground">
            {build.roleLabel}
          </p>
          <p
            className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold"
            title={build.displayName}
          >
            {showJob && build.jobDisplayName ? (
              <span className="min-w-0 [overflow-wrap:anywhere]">{build.jobDisplayName}</span>
            ) : null}
            <span className="shrink-0 tabular-nums">{build.buildNumberLabel}</span>
          </p>
        </div>
        <ResultBadge status={build.resultClass} label={build.resultLabel} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="tabular-nums">{build.durationLabel}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Started</dt>
            <dd className="tabular-nums">{build.timestampLabel}</dd>
          </div>
        </dl>
        <Button
          variant="outline"
          size="xs"
          aria-label={`Open build details for ${side} build ${build.buildNumberLabel}`}
          onClick={() => postVsCodeMessage({ type: "openBuildDetails", side })}
        >
          Open details
        </Button>
      </div>
    </Card>
  );
}

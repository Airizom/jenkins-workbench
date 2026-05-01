import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
import type { SummaryMetricTone } from "./testResultsTypes";
import {
  getTestDistribution,
  metricCardClassName,
  metricDotClassName,
  metricToneClassName
} from "./testResultsUtils";

export function TestResultsSummaryCard({
  summary,
  passRate
}: {
  summary: BuildTestsSummaryViewModel;
  passRate: number;
}) {
  return (
    <div className="rounded border border-border bg-muted-soft p-3 space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-background">
            <TestTubeIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Test Results</span>
              {summary.hasAnyResults ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0",
                    summary.failedCount > 0
                      ? "border-failure-border-subtle text-failure"
                      : "border-success-border text-success"
                  )}
                >
                  {passRate}% passed
                </Badge>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground">{summary.summaryLabel}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryMetric label="Failed" value={summary.failedCount} tone="failed" />
          <SummaryMetric label="Skipped" value={summary.skippedCount} tone="skipped" />
          <SummaryMetric label="Passed" value={summary.passedCount} tone="passed" />
          <SummaryMetric label="Total" value={summary.totalCount} tone="neutral" />
        </div>
      </div>
      {summary.hasAnyResults ? <TestDistributionBar summary={summary} /> : null}
    </div>
  );
}

function TestDistributionBar({ summary }: { summary: BuildTestsSummaryViewModel }) {
  const { failedPct, skippedPct, passedPct } = getTestDistribution(summary);

  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={`${Math.round(passedPct)}% tests passed`}
      aria-valuenow={Math.round(passedPct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {failedPct > 0 ? (
        <div
          className="bg-failure transition-all duration-300"
          style={{ width: `${failedPct}%` }}
        />
      ) : null}
      {skippedPct > 0 ? (
        <div
          className="bg-warning transition-all duration-300"
          style={{ width: `${skippedPct}%` }}
        />
      ) : null}
      {passedPct > 0 ? (
        <div
          className="bg-success transition-all duration-300"
          style={{ width: `${passedPct}%` }}
        />
      ) : null}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: SummaryMetricTone;
}) {
  return (
    <div className={cn("rounded border px-3 py-2", metricCardClassName(tone))}>
      <div className="flex items-center gap-1.5">
        {tone !== "neutral" ? (
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", metricDotClassName(tone))} />
        ) : null}
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", metricToneClassName(tone))}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

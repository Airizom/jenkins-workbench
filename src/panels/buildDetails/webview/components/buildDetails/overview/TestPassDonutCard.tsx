import type * as React from "react";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { ToneMetricCard } from "../../../../../shared/webview/components/ToneMetricCard";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
import { getTestDistribution } from "../testResults/testResultsUtils";

/**
 * Formats the pass rate without ever rounding up to 100% while any test failed:
 * failures floor the value (one decimal above 99%, capped at 99.9).
 */
export function formatPassRate(passedPct: number, failedCount: number): string {
  if (failedCount === 0) {
    return String(Math.round(passedPct));
  }
  if (passedPct >= 99) {
    return Math.min(Math.floor(passedPct * 10) / 10, 99.9).toFixed(1);
  }
  return String(Math.floor(passedPct));
}

type TestPassDonutCardProps = {
  summary: BuildTestsSummaryViewModel;
  onShowTests: () => void;
};
export function TestPassDonutCard({
  summary,
  onShowTests
}: TestPassDonutCardProps): React.JSX.Element {
  const distribution = getTestDistribution(summary);
  const passRate = formatPassRate(distribution.passedPct, summary.failedCount);
  const hasFailures = summary.failedCount > 0;
  const badgeTone = summary.passedCount === 0 && summary.skippedCount > 0 ? "skipped" : "passed";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <TestTubeIcon className="h-4 w-4" />
          <CardTitle>Tests</CardTitle>
        </div>
        {summary.hasAnyResults && !hasFailures ? (
          <ToneBadge label={`${passRate}% passed`} tone={badgeTone} />
        ) : null}
      </CardHeader>
      <CardContent className="pb-4">
        {summary.totalCount > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            <TestPassDonut summary={summary} passRate={passRate} distribution={distribution} />
            <div className="flex min-w-[240px] flex-1 flex-col gap-3">
              {hasFailures ? (
                <p className="m-0 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-lg font-semibold text-failure">
                    {summary.failedCount.toLocaleString()} failed
                  </span>
                  <span className="text-xs text-muted-foreground">
                    of {summary.totalCount.toLocaleString()} · {passRate}% passed
                  </span>
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                <ToneMetricCard label="Failed" value={summary.failedCount} tone="failed" showDot />
                <ToneMetricCard
                  label="Skipped"
                  value={summary.skippedCount}
                  tone="skipped"
                  showDot
                />
                <ToneMetricCard label="Passed" value={summary.passedCount} tone="passed" showDot />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
            {summary.summaryLabel}
          </div>
        )}
        <Button
          variant="link"
          size="sm"
          className="mt-3 text-xs"
          onClick={onShowTests}
          title="Opens the Tests tab"
        >
          {hasFailures ? "View failed tests" : "View test results"}
        </Button>
      </CardContent>
    </Card>
  );
}

function TestPassDonut({
  summary,
  passRate,
  distribution
}: {
  summary: BuildTestsSummaryViewModel;
  passRate: string;
  distribution: ReturnType<typeof getTestDistribution>;
}): React.JSX.Element {
  const { failedPct, skippedPct, passedPct } = distribution;
  const hasFailures = summary.failedCount > 0;
  const segments = [
    { pct: passedPct, start: 0, className: "text-success" },
    { pct: failedPct, start: passedPct, className: "text-failure" },
    { pct: skippedPct, start: passedPct + failedPct, className: "text-warning" }
  ];
  const label = hasFailures
    ? `${summary.failedCount} of ${summary.totalCount} tests failed: ${passRate}% passed, ${summary.skippedCount} skipped`
    : `${passRate}% tests passed: ${summary.passedCount} passed, ${summary.failedCount} failed, ${summary.skippedCount} skipped`;

  return (
    <svg viewBox="0 0 40 40" className="h-28 w-28 shrink-0" role="img" aria-label={label}>
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        className="text-muted"
      />
      {segments.map((segment) =>
        segment.pct > 0 ? (
          <circle
            key={segment.className}
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            pathLength={100}
            strokeDasharray={`${segment.pct} ${100 - segment.pct}`}
            strokeDashoffset={-segment.start}
            className={`donut-segment ${segment.className}`}
            style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
          />
        ) : null
      )}
      {hasFailures ? (
        <>
          <text
            x="20"
            y="18.5"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-failure font-semibold"
            style={{ fontSize: "9px" }}
          >
            {summary.failedCount.toLocaleString()}
          </text>
          <text
            x="20"
            y="25.5"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground"
            style={{ fontSize: "4px" }}
          >
            failed
          </text>
        </>
      ) : (
        <text
          x="20"
          y="20"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-semibold"
          style={{ fontSize: "9px" }}
        >
          {passRate}%
        </text>
      )}
    </svg>
  );
}

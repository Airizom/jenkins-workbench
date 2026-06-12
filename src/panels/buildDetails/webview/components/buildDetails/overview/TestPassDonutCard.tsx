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
import { getPassRate, getTestDistribution } from "../testResults/testResultsUtils";

type TestPassDonutCardProps = {
  summary: BuildTestsSummaryViewModel;
  onShowTests: () => void;
};
export function TestPassDonutCard({ summary, onShowTests }: TestPassDonutCardProps): JSX.Element {
  const passRate = getPassRate(summary);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <TestTubeIcon className="h-4 w-4" />
          <CardTitle>Tests</CardTitle>
        </div>
        {summary.hasAnyResults ? (
          <ToneBadge
            label={`${passRate}% passed`}
            tone={summary.failedCount > 0 ? "failed" : "passed"}
          />
        ) : null}
      </CardHeader>
      <CardContent className="pb-4">
        {summary.totalCount > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            <TestPassDonut summary={summary} passRate={passRate} />
            <div className="grid flex-1 grid-cols-3 gap-2 min-w-[180px]">
              <ToneMetricCard label="Failed" value={summary.failedCount} tone="failed" showDot />
              <ToneMetricCard label="Skipped" value={summary.skippedCount} tone="skipped" showDot />
              <ToneMetricCard label="Passed" value={summary.passedCount} tone="passed" showDot />
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
          aria-label="Open the Tests tab"
        >
          View test results
        </Button>
      </CardContent>
    </Card>
  );
}

function TestPassDonut({
  summary,
  passRate
}: {
  summary: BuildTestsSummaryViewModel;
  passRate: number;
}): JSX.Element {
  const { failedPct, skippedPct, passedPct } = getTestDistribution(summary);
  const segments = [
    { pct: passedPct, start: 0, className: "text-success" },
    { pct: failedPct, start: passedPct, className: "text-failure" },
    { pct: skippedPct, start: passedPct + failedPct, className: "text-warning" }
  ];

  return (
    <svg
      viewBox="0 0 40 40"
      className="h-28 w-28 shrink-0"
      role="img"
      aria-label={`${passRate}% tests passed: ${summary.passedCount} passed, ${summary.failedCount} failed, ${summary.skippedCount} skipped`}
    >
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
    </svg>
  );
}

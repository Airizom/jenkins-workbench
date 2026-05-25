import { MetricsSummarySection } from "../../../../../shared/webview/components/MetricsSummarySection";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { ToneMetricCard } from "../../../../../shared/webview/components/ToneMetricCard";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
import { getTestDistribution } from "./testResultsUtils";

export function TestResultsSummaryCard({
  summary,
  passRate
}: {
  summary: BuildTestsSummaryViewModel;
  passRate: number;
}) {
  return (
    <MetricsSummarySection
      icon={<TestTubeIcon className="h-4 w-4" />}
      title="Test Results"
      badge={
        summary.hasAnyResults ? (
          <ToneBadge
            label={`${passRate}% passed`}
            tone={summary.failedCount > 0 ? "failed" : "passed"}
          />
        ) : undefined
      }
      description={summary.summaryLabel}
      metrics={
        <>
          <ToneMetricCard label="Failed" value={summary.failedCount} tone="failed" showDot />
          <ToneMetricCard label="Skipped" value={summary.skippedCount} tone="skipped" showDot />
          <ToneMetricCard label="Passed" value={summary.passedCount} tone="passed" showDot />
          <ToneMetricCard label="Total" value={summary.totalCount} tone="neutral" />
        </>
      }
      footer={summary.hasAnyResults ? <TestDistributionBar summary={summary} /> : undefined}
    />
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

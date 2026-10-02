import { MetricsSummarySection } from "../../../../../shared/webview/components/MetricsSummarySection";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { ToneMetricCard } from "../../../../../shared/webview/components/ToneMetricCard";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
import { describeTestOutcome, getTestDistribution } from "./testResultsUtils";

export function TestResultsSummaryCard({ summary }: { summary: BuildTestsSummaryViewModel }) {
  const { failedPct, skippedPct, passedPct } = getTestDistribution(summary);
  const outcome = describeTestOutcome(summary);
  const meterValue = Math.floor((outcome.passRate ?? 0) * 10) / 10;

  return (
    <MetricsSummarySection
      icon={<TestTubeIcon className="h-4 w-4" />}
      title="Test results"
      badge={
        summary.hasAnyResults ? (
          <ToneBadge label={outcome.passRateLabel} tone={outcome.tone} />
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
      footer={
        summary.hasAnyResults ? (
          <>
            <meter
              aria-label={`Tests ${outcome.passRateLabel.toLowerCase()}`}
              aria-valuenow={meterValue}
              className="sr-only"
              min={0}
              max={100}
              value={meterValue}
            >
              {outcome.passRateLabel}
            </meter>
            <div
              aria-hidden="true"
              className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
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
          </>
        ) : undefined
      }
    />
  );
}

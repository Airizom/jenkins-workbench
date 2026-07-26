import { MetricsSummarySection } from "../../../../../shared/webview/components/MetricsSummarySection";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { ToneMetricCard } from "../../../../../shared/webview/components/ToneMetricCard";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
import { getTestDistribution } from "./testResultsUtils";

export function TestResultsSummaryCard({ summary }: { summary: BuildTestsSummaryViewModel }) {
  const { failedPct, skippedPct, passedPct } = getTestDistribution(summary);
  const passedPercent = Math.round(passedPct);

  return (
    <MetricsSummarySection
      icon={<TestTubeIcon className="h-4 w-4" />}
      title="Test Results"
      badge={
        summary.hasAnyResults ? (
          <ToneBadge
            label={`${passedPercent}% passed`}
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
      footer={
        summary.hasAnyResults ? (
          <>
            <meter
              aria-label={`${passedPercent}% tests passed`}
              aria-valuenow={passedPercent}
              className="sr-only"
              min={0}
              max={100}
              value={passedPercent}
            >
              {passedPercent}% tests passed
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

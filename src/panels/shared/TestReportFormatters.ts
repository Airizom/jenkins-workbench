import { formatNumber } from "../../formatters/DisplayFormatters";
import { formatCompactDurationFromTotalSeconds } from "../../formatters/DurationFormatters";
import { EMPTY_TEST_RESULTS_LABEL } from "./TestReportConstants";

export function formatTestDuration(durationSeconds?: number): string | undefined {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return undefined;
  }
  if (durationSeconds < 1) {
    return `${Math.round(durationSeconds * 1000)} ms`;
  }
  if (durationSeconds < 60) {
    const rounded = Math.round(durationSeconds * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} s`;
  }
  return formatCompactDurationFromTotalSeconds(Math.round(durationSeconds));
}

export { EMPTY_TEST_RESULTS_LABEL } from "./TestReportConstants";

export interface TestReportCountSummaryInput {
  failed?: number;
  total?: number;
  skipped?: number;
}

export interface TestReportCountSource {
  failCount?: number;
  totalCount?: number;
  skipCount?: number;
}

export function formatAvailableTestReportCountsSummary(report: TestReportCountSource): string {
  return formatTestReportCountsSummary({
    failed: report.failCount,
    total: report.totalCount,
    skipped: report.skipCount
  });
}

export function formatTestReportCountsSummary(input: TestReportCountSummaryInput): string {
  const failed = input.failed ?? 0;
  const total = input.total ?? 0;
  const skipped = input.skipped ?? 0;
  const hasAnyResults = total > 0 || failed > 0 || skipped > 0;

  if (!hasAnyResults) {
    return EMPTY_TEST_RESULTS_LABEL;
  }
  if (typeof input.failed === "number" && typeof input.total === "number") {
    let label = `Failed ${formatNumber(input.failed)} / ${formatNumber(input.total)}`;
    if (typeof input.skipped === "number") {
      label += ` • Skipped ${formatNumber(input.skipped)}`;
    }
    return label;
  }
  if (typeof input.total === "number") {
    return `Total ${formatNumber(input.total)} tests`;
  }
  if (typeof input.failed === "number") {
    return `Failed ${formatNumber(input.failed)} tests`;
  }
  return EMPTY_TEST_RESULTS_LABEL;
}

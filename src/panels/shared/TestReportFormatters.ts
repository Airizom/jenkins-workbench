import { formatNumber } from "../buildDetails/BuildDetailsFormatters";

export interface TestReportCountSummaryInput {
  failed?: number;
  total?: number;
  skipped?: number;
}

export function formatTestReportCountsSummary(input: TestReportCountSummaryInput): string {
  const failed = input.failed ?? 0;
  const total = input.total ?? 0;
  const skipped = input.skipped ?? 0;
  const hasAnyResults = total > 0 || failed > 0 || skipped > 0;

  if (!hasAnyResults) {
    return "No test results.";
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
  return "No test results.";
}

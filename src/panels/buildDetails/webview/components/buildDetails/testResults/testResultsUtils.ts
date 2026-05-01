import type {
  BuildTestCaseViewModel,
  BuildTestsSummaryViewModel,
  TestResultStatus
} from "../../../../shared/BuildDetailsContracts";
import type { CoverageTone, SummaryMetricTone, TestStatusFilter } from "./testResultsTypes";

export const RENDER_BATCH_SIZE = 500;
export const AUTO_EXPAND_FAILED_LIMIT = 3;

export function getTestResultsDatasetKey(
  buildUrl: string | undefined,
  items: BuildTestCaseViewModel[]
): string {
  return [buildUrl ?? "", ...items.map((item) => item.id)].join("::");
}

export function filterTestResults(
  items: BuildTestCaseViewModel[],
  statusFilter: TestStatusFilter,
  query: string
): BuildTestCaseViewModel[] {
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  return items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) {
      return false;
    }
    if (!trimmedQuery) {
      return true;
    }
    const haystack = [item.name, item.className, item.suiteName, item.statusLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function getAutoExpandIds(items: BuildTestCaseViewModel[]): Set<string> {
  const ids = new Set<string>();
  let count = 0;
  for (const item of items) {
    if (item.status === "failed" && hasTestDetails(item) && count < AUTO_EXPAND_FAILED_LIMIT) {
      ids.add(item.id);
      count++;
    }
  }
  return ids;
}

export function getPassRate(summary: BuildTestsSummaryViewModel): number {
  return summary.totalCount > 0 ? Math.round((summary.passedCount / summary.totalCount) * 100) : 0;
}

export function getTestDistribution(summary: BuildTestsSummaryViewModel): {
  failedPct: number;
  skippedPct: number;
  passedPct: number;
} {
  const total = Math.max(summary.totalCount, 1);
  return {
    failedPct: (summary.failedCount / total) * 100,
    skippedPct: (summary.skippedCount / total) * 100,
    passedPct: (summary.passedCount / total) * 100
  };
}

export function hasTestDetails(item: BuildTestCaseViewModel): boolean {
  return Boolean(item.errorDetails || item.errorStackTrace || item.stdout || item.stderr);
}

export function statusBorderClass(status: TestResultStatus): string {
  switch (status) {
    case "failed":
      return "border-l-2 border-l-failure";
    case "skipped":
      return "border-l-2 border-l-warning";
    default:
      return "";
  }
}

export function metricCardClassName(tone: SummaryMetricTone): string {
  switch (tone) {
    case "failed":
      return "border-failure-border-subtle bg-failure-surface";
    case "skipped":
      return "border-border bg-warning-surface";
    case "passed":
      return "border-success-border bg-success-soft";
    default:
      return "border-border bg-background";
  }
}

export function metricDotClassName(tone: Exclude<SummaryMetricTone, "neutral">): string {
  switch (tone) {
    case "failed":
      return "bg-failure";
    case "skipped":
      return "bg-warning";
    case "passed":
      return "bg-success";
  }
}

export function metricToneClassName(tone: SummaryMetricTone): string {
  switch (tone) {
    case "failed":
      return "text-failure";
    case "skipped":
      return "text-warning";
    case "passed":
      return "text-success";
    default:
      return "text-foreground";
  }
}

export function mapToneToMetricTone(tone: CoverageTone): SummaryMetricTone {
  switch (tone) {
    case "success":
      return "passed";
    case "warning":
      return "skipped";
    case "failure":
      return "failed";
    default:
      return "neutral";
  }
}

export function coverageToneClassName(tone: CoverageTone): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "failure":
      return "text-failure";
    default:
      return "text-foreground";
  }
}

export function coverageStatusBadgeClassName(statusClass?: string): string {
  switch (statusClass) {
    case "success":
      return "border-success-border text-success";
    case "warning":
      return "border-border text-warning";
    case "failure":
      return "border-failure-border-subtle text-failure";
    default:
      return "border-border text-muted-foreground";
  }
}

export function toCoverageTone(statusClass?: string): CoverageTone {
  switch (statusClass) {
    case "success":
    case "warning":
    case "failure":
      return statusClass;
    default:
      return "neutral";
  }
}

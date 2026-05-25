import type {
  BuildTestCaseViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { TestStatusFilter } from "./testResultsTypes";

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

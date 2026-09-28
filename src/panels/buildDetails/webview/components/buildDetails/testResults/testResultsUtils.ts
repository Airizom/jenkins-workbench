import type {
  BuildTestCaseViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { TestStatusFilter } from "./testResultsTypes";
export const RENDER_BATCH_SIZE = 500;
const AUTO_EXPAND_FAILED_LIMIT = 3;
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
  for (const item of items) {
    if (item.status === "failed" && hasTestDetails(item)) {
      ids.add(item.id);
      if (ids.size >= AUTO_EXPAND_FAILED_LIMIT) {
        break;
      }
    }
  }
  return ids;
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

export interface TestFailureBlock {
  label: "Failure" | "Stack Trace";
  value: string;
}

/**
 * Jenkins stack traces usually begin with the failure message. Show that
 * message once: a stack trace that already starts with it is labelled
 * "Failure" and replaces the separate message block.
 */
export function resolveFailureBlocks(
  errorDetails: string | undefined,
  errorStackTrace: string | undefined
): TestFailureBlock[] {
  const details = errorDetails?.trim() ? errorDetails : undefined;
  const stackTrace = errorStackTrace?.trim() ? errorStackTrace : undefined;
  if (details && stackTrace?.trimStart().startsWith(details.trim())) {
    return [{ label: "Failure", value: stackTrace }];
  }
  const blocks: TestFailureBlock[] = [];
  if (details) {
    blocks.push({ label: "Failure", value: details });
  }
  if (stackTrace) {
    blocks.push({ label: "Stack Trace", value: stackTrace });
  }
  return blocks;
}

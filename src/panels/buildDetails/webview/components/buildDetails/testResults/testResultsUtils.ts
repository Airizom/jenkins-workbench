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
/**
 * Formats the pass rate without ever rounding up to 100% while any test failed:
 * failures floor the value (one decimal above 99%, capped at 99.9), and a
 * non-zero rate below 1% reads "<1" rather than "0".
 */
export function formatPassRate(passedPct: number, failedCount: number): string {
  if (failedCount === 0) {
    return String(Math.round(passedPct));
  }
  if (passedPct >= 99) {
    return Math.min(Math.floor(passedPct * 10) / 10, 99.9).toFixed(1);
  }
  if (passedPct > 0 && passedPct < 1) {
    return "<1";
  }
  return String(Math.floor(passedPct));
}

export type TestOutcomeTone = "passed" | "failed" | "skipped";

export interface TestOutcomeSummary {
  /** Passed share of executed (passed + failed) tests; undefined when nothing ran. */
  passRate?: number;
  /** "99.7% passed", or "All skipped" when every test was skipped. */
  passRateLabel: string;
  /** Count phrasing for compact badges, e.g. "920 passed · 6 skipped". */
  countsLabel: string;
  /** Driven by failures only; skipped tests never make a run look failed. */
  tone: TestOutcomeTone;
}

/**
 * One shared reading of a test summary for the hero badge, the overview donut,
 * and the Tests tab header. Skipped tests are left out of the pass rate so a
 * clean run with skips reports 100% rather than an alarming 99%.
 */
export function describeTestOutcome(summary: BuildTestsSummaryViewModel): TestOutcomeSummary {
  const { passedCount, failedCount, skippedCount } = summary;
  const executed = passedCount + failedCount;
  const passRate = executed > 0 ? (passedCount / executed) * 100 : undefined;
  const passRateLabel =
    passRate === undefined ? "All skipped" : `${formatPassRate(passRate, failedCount)}% passed`;
  const tone: TestOutcomeTone =
    failedCount > 0 ? "failed" : passRate === undefined && skippedCount > 0 ? "skipped" : "passed";
  return { passRate, passRateLabel, countsLabel: formatTestCountsLabel(summary), tone };
}

function formatTestCountsLabel(summary: BuildTestsSummaryViewModel): string {
  const { passedCount, failedCount, skippedCount, totalCount } = summary;
  if (failedCount > 0) {
    return `${failedCount.toLocaleString()} failed of ${totalCount.toLocaleString()} tests`;
  }
  const parts: string[] = [];
  if (passedCount > 0 || skippedCount === 0) {
    parts.push(`${passedCount.toLocaleString()} passed`);
  }
  if (skippedCount > 0) {
    parts.push(`${skippedCount.toLocaleString()} skipped`);
  }
  return parts.join(" · ");
}

export function hasTestDetails(item: BuildTestCaseViewModel): boolean {
  return Boolean(item.errorDetails || item.errorStackTrace || item.stdout || item.stderr);
}

export interface TestFailureBlock {
  label: "Failure" | "Stack trace";
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
    blocks.push({ label: "Stack trace", value: stackTrace });
  }
  return blocks;
}

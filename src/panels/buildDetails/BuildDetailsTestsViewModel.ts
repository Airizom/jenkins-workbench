import type {
  JenkinsBuildDetails,
  JenkinsTestReport,
  JenkinsTestSummaryAction
} from "../../jenkins/types";
import { formatNumber, formatTestDuration } from "./BuildDetailsFormatters";
import type {
  BuildDetailsTestStateViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel
} from "./shared/BuildDetailsContracts";

const MAX_TEST_CASE_LOG_CHARS = 8000;
const TEST_CASE_LOG_TRUNCATION_SUFFIX = "\n... (truncated)";

export interface BuildTestsSummaryOptions {
  testReportFetched?: boolean;
  logsIncluded?: boolean;
}

export interface BuildTestStateOptions extends BuildTestsSummaryOptions {
  loading?: boolean;
  canOpenSource?: (className?: string) => boolean;
}

export function buildTestsSummary(
  details?: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  options?: BuildTestsSummaryOptions
): BuildTestsSummaryViewModel {
  const action = findTestSummaryAction(details?.actions ?? null);
  const failed = pickNumber(testReport?.failCount, action?.failCount);
  const total = pickNumber(testReport?.totalCount, action?.totalCount);
  const skipped = pickNumber(testReport?.skipCount, action?.skipCount);
  const resolvedFailed = failed ?? 0;
  const resolvedTotal = total ?? 0;
  const resolvedSkipped = skipped ?? 0;
  const passedCount = Math.max(0, resolvedTotal - resolvedFailed - resolvedSkipped);
  const hasDetailedResults = Boolean(
    testReport?.suites?.some((suite) => (suite.cases?.length ?? 0) > 0)
  );
  const hasAnyResults =
    resolvedTotal > 0 || resolvedFailed > 0 || resolvedSkipped > 0 || hasDetailedResults;
  const detailsUnavailable =
    Boolean(options?.testReportFetched) && hasAnyResults && !hasDetailedResults;
  const logsIncluded = Boolean(options?.logsIncluded && hasDetailedResults);

  let label = "No test results.";
  if (!hasAnyResults) {
    label = "No test results.";
  } else if (typeof failed === "number" && typeof total === "number") {
    label = `Failed ${formatNumber(failed)} / ${formatNumber(total)}`;
    if (typeof skipped === "number") {
      label += ` • Skipped ${formatNumber(skipped)}`;
    }
  } else if (typeof total === "number") {
    label = `Total ${formatNumber(total)} tests`;
  } else if (typeof failed === "number") {
    label = `Failed ${formatNumber(failed)} tests`;
  }

  return {
    totalCount: resolvedTotal,
    failedCount: resolvedFailed,
    skippedCount: resolvedSkipped,
    passedCount,
    summaryLabel: label,
    hasAnyResults,
    hasDetailedResults,
    detailsUnavailable,
    logsIncluded,
    canLoadLogs: hasDetailedResults && !logsIncluded
  };
}

export function buildTestStateViewModel(
  details?: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  options?: BuildTestStateOptions
): BuildDetailsTestStateViewModel {
  const summary = buildTestsSummary(details, testReport, options);
  const results = buildTestResultsViewModel(testReport, {
    canOpenSource: options?.canOpenSource,
    loading: options?.loading
  });
  return {
    summary,
    results
  };
}

type BuildAction = NonNullable<NonNullable<JenkinsBuildDetails["actions"]>[number]>;

function isTestSummaryAction(action: BuildAction): action is JenkinsTestSummaryAction {
  const candidate = action as JenkinsTestSummaryAction;
  return (
    typeof candidate.failCount === "number" ||
    typeof candidate.totalCount === "number" ||
    typeof candidate.skipCount === "number"
  );
}

function findTestSummaryAction(
  actions: JenkinsBuildDetails["actions"]
): JenkinsTestSummaryAction | undefined {
  if (!actions || actions.length === 0) {
    return undefined;
  }
  for (const action of actions) {
    if (action && isTestSummaryAction(action)) {
      return action;
    }
  }
  return undefined;
}

export function buildTestResultsViewModel(
  testReport: JenkinsTestReport | undefined,
  options?: { canOpenSource?: (className?: string) => boolean; loading?: boolean }
): BuildTestResultsViewModel {
  if (!testReport) {
    return buildEmptyTestResultsViewModel(options?.loading);
  }

  const items: BuildTestCaseViewModel[] = [];
  for (const [suiteIndex, suite] of (testReport.suites ?? []).entries()) {
    const suiteName = suite.name?.trim() || undefined;
    for (const [caseIndex, testCase] of (suite.cases ?? []).entries()) {
      const name = testCase.name?.trim() || testCase.className?.trim() || "Unnamed test";
      const className = testCase.className?.trim() || undefined;
      const status = normalizeTestStatus(testCase.status);
      items.push({
        id: buildTestCaseId(suiteName, className, name, suiteIndex, caseIndex),
        name,
        className,
        suiteName,
        status,
        statusLabel: formatTestStatusLabel(status),
        durationLabel: formatTestDuration(testCase.duration),
        errorDetails: normalizeTestText(testCase.errorDetails, true),
        errorStackTrace: normalizeTestText(testCase.errorStackTrace, true),
        stdout: normalizeTestText(testCase.stdout, true),
        stderr: normalizeTestText(testCase.stderr, true),
        canOpenSource: Boolean(options?.canOpenSource?.(className))
      });
    }
  }

  items.sort(compareTestCases);
  return {
    items,
    loading: Boolean(options?.loading)
  };
}

export function buildEmptyTestResultsViewModel(loading = false): BuildTestResultsViewModel {
  return {
    items: [],
    loading
  };
}

function isFailedTestCase(status?: string): boolean {
  if (!status) {
    return false;
  }
  const normalized = status.toUpperCase();
  if (normalized === "PASSED" || normalized === "SKIPPED") {
    return false;
  }
  return true;
}

function normalizeTestStatus(status?: string): BuildTestCaseViewModel["status"] {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) {
    return "other";
  }
  if (normalized === "PASSED" || normalized === "FIXED") {
    return "passed";
  }
  if (normalized === "SKIPPED" || normalized === "REGRESSION_SKIPPED") {
    return "skipped";
  }
  if (isFailedTestCase(normalized)) {
    return "failed";
  }
  return "other";
}

function formatTestStatusLabel(status: BuildTestCaseViewModel["status"]): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Other";
  }
}

function buildTestCaseId(
  suiteName: string | undefined,
  className: string | undefined,
  name: string,
  suiteIndex: number,
  caseIndex: number
): string {
  return [suiteName ?? "", className ?? "", name, String(suiteIndex), String(caseIndex)].join("::");
}

function compareTestCases(left: BuildTestCaseViewModel, right: BuildTestCaseViewModel): number {
  const statusRank = getTestStatusSortRank(left.status) - getTestStatusSortRank(right.status);
  if (statusRank !== 0) {
    return statusRank;
  }
  const suiteRank = (left.suiteName ?? "").localeCompare(right.suiteName ?? "");
  if (suiteRank !== 0) {
    return suiteRank;
  }
  const classRank = (left.className ?? "").localeCompare(right.className ?? "");
  if (classRank !== 0) {
    return classRank;
  }
  return left.name.localeCompare(right.name);
}

function getTestStatusSortRank(status: BuildTestCaseViewModel["status"]): number {
  switch (status) {
    case "failed":
      return 0;
    case "skipped":
      return 1;
    case "passed":
      return 2;
    default:
      return 3;
  }
}

function normalizeTestText(value?: string, allowTruncation = false): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!allowTruncation || trimmed.length <= MAX_TEST_CASE_LOG_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_TEST_CASE_LOG_CHARS)}${TEST_CASE_LOG_TRUNCATION_SUFFIX}`;
}

function pickNumber(primary?: number, fallback?: number): number | undefined {
  if (typeof primary === "number" && Number.isFinite(primary)) {
    return primary;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  return undefined;
}

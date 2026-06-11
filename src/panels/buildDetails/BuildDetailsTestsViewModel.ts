import type {
  JenkinsBuildDetails,
  JenkinsTestReport,
  JenkinsTestSummaryAction
} from "../../jenkins/types";
import { pickFiniteNumber } from "../../shared/numbers";
import {
  buildTestCaseId,
  forEachNormalizedTestCase,
  normalizeTestCaseBase
} from "../shared/TestCaseViewModel";
import {
  EMPTY_TEST_RESULTS_LABEL,
  formatTestReportCountsSummary
} from "../shared/TestReportFormatters";
import { getTestStatusSortRank } from "../shared/TestStatusFormatters";
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
  const failed = pickFiniteNumber(testReport?.failCount, action?.failCount);
  const total = pickFiniteNumber(testReport?.totalCount, action?.totalCount);
  const skipped = pickFiniteNumber(testReport?.skipCount, action?.skipCount);
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

  const label = !hasAnyResults
    ? EMPTY_TEST_RESULTS_LABEL
    : formatTestReportCountsSummary({ failed, total, skipped });

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
function buildTestResultsViewModel(
  testReport: JenkinsTestReport | undefined,
  options?: { canOpenSource?: (className?: string) => boolean; loading?: boolean }
): BuildTestResultsViewModel {
  if (!testReport) {
    return buildEmptyTestResultsViewModel(options?.loading);
  }

  const items: BuildTestCaseViewModel[] = [];
  forEachNormalizedTestCase(testReport, (testCase, { suiteName, suiteIndex, caseIndex }) => {
    const normalized = normalizeTestCaseBase(testCase, suiteName, {
      fallbackToClassName: true
    });
    if (!normalized) {
      return;
    }
    items.push({
      id: buildTestCaseId(
        normalized.className,
        normalized.suiteName,
        normalized.name,
        suiteIndex,
        caseIndex
      ),
      name: normalized.name,
      className: normalized.className,
      suiteName: normalized.suiteName,
      status: normalized.status,
      statusLabel: normalized.statusLabel,
      durationLabel: normalized.durationLabel,
      errorDetails: normalizeTestText(testCase.errorDetails, true),
      errorStackTrace: normalizeTestText(testCase.errorStackTrace, true),
      stdout: normalizeTestText(testCase.stdout, true),
      stderr: normalizeTestText(testCase.stderr, true),
      canOpenSource: Boolean(options?.canOpenSource?.(normalized.className))
    });
  });

  items.sort(compareTestCases);
  return {
    items,
    loading: Boolean(options?.loading)
  };
}
function buildEmptyTestResultsViewModel(loading = false): BuildTestResultsViewModel {
  return {
    items: [],
    loading
  };
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

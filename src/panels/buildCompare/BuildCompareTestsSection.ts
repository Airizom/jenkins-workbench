import { formatNumber } from "../../formatters/DisplayFormatters";
import type { JenkinsTestReport } from "../../jenkins/types";
import {
  type NormalizedTestCaseBase,
  forEachNormalizedTestCase,
  normalizeTestCaseBase
} from "../shared/TestCaseViewModel";
import { formatAvailableTestReportCountsSummary } from "../shared/TestReportFormatters";
import { forEachKeyedDiff } from "./BuildCompareDiff";
import type { BuildCompareOptionalResult } from "./BuildCompareLoadState";
import { buildOccurrenceKey, evaluateStandardCompareSection } from "./BuildCompareSectionShared";
import type {
  BuildCompareTestDiffItem,
  BuildCompareTestsSectionViewModel
} from "./shared/BuildCompareContracts";

type NormalizedTestCase = NormalizedTestCaseBase;

type TestCompareEmptyFields = Pick<
  BuildCompareTestsSectionViewModel,
  | "newFailures"
  | "stillFailing"
  | "newPasses"
  | "addedTests"
  | "removedTests"
  | "otherChangesCount"
  | "unchangedCount"
  | "baselineSummaryLabel"
  | "targetSummaryLabel"
>;

const EMPTY_TEST_DIFF_LISTS: Pick<
  BuildCompareTestsSectionViewModel,
  | "newFailures"
  | "stillFailing"
  | "newPasses"
  | "addedTests"
  | "removedTests"
  | "otherChangesCount"
  | "unchangedCount"
> = {
  newFailures: [],
  stillFailing: [],
  newPasses: [],
  addedTests: [],
  removedTests: [],
  otherChangesCount: 0,
  unchangedCount: 0
};

export function buildTestsSection(
  baselineReport: BuildCompareOptionalResult<JenkinsTestReport>,
  targetReport: BuildCompareOptionalResult<JenkinsTestReport>
): BuildCompareTestsSectionViewModel {
  const testSummaryFields = {
    baselineSummaryLabel: buildTestSummaryLabel(baselineReport),
    targetSummaryLabel: buildTestSummaryLabel(targetReport),
    ...EMPTY_TEST_DIFF_LISTS
  };

  return evaluateStandardCompareSection<
    JenkinsTestReport,
    TestCompareEmptyFields,
    BuildCompareTestsSectionViewModel
  >(baselineReport, targetReport, {
    dataLabel: "Test report",
    errorSummaryLabel: "Test comparison unavailable",
    unavailableSummaryLabel: "Test report data unavailable",
    bothUnavailableDetail: "Neither build exposed a Jenkins test report.",
    partialUnavailableDetail: "Both builds need test report data for a reliable comparison.",
    emptyFields: {
      ...EMPTY_TEST_DIFF_LISTS,
      baselineSummaryLabel: "Unavailable",
      targetSummaryLabel: "Unavailable"
    },
    bothUnavailableFields: {
      baselineSummaryLabel: "Unavailable",
      targetSummaryLabel: "Unavailable",
      ...EMPTY_TEST_DIFF_LISTS
    },
    resolveErrorFields: () => testSummaryFields,
    resolvePartialFields: () => testSummaryFields,
    onAvailable: (baselineValue, targetValue) =>
      buildAvailableTestsSection(baselineReport, targetReport, baselineValue, targetValue)
  });
}

function buildAvailableTestsSection(
  baselineReport: BuildCompareOptionalResult<JenkinsTestReport>,
  targetReport: BuildCompareOptionalResult<JenkinsTestReport>,
  baselineValue: JenkinsTestReport,
  targetValue: JenkinsTestReport
): BuildCompareTestsSectionViewModel {
  const baselineCases = buildTestCaseMap(baselineValue);
  const targetCases = buildTestCaseMap(targetValue);
  const newFailures: BuildCompareTestDiffItem[] = [];
  const stillFailing: BuildCompareTestDiffItem[] = [];
  const newPasses: BuildCompareTestDiffItem[] = [];
  const addedTests: BuildCompareTestDiffItem[] = [];
  const removedTests: BuildCompareTestDiffItem[] = [];
  let otherChangesCount = 0;
  let unchangedCount = 0;

  forEachKeyedDiff(baselineCases, targetCases, {
    onAdded: (_key, target) => {
      addedTests.push(buildSingleSideTestDiffItem(target, "added"));
    },
    onRemoved: (_key, baseline) => {
      removedTests.push(buildSingleSideTestDiffItem(baseline, "removed"));
    },
    onBoth: (_key, baseline, target) => {
      const item = buildTestDiffItem(baseline, target);
      if (target.status === "failed" && baseline.status !== "failed") {
        newFailures.push(item);
      } else if (target.status === "failed" && baseline.status === "failed") {
        stillFailing.push(item);
      } else if (baseline.status === "failed" && target.status === "passed") {
        newPasses.push(item);
      } else if (baseline.status === target.status) {
        unchangedCount += 1;
      } else {
        otherChangesCount += 1;
      }
    }
  });

  const hasDiffs =
    newFailures.length > 0 ||
    stillFailing.length > 0 ||
    newPasses.length > 0 ||
    addedTests.length > 0 ||
    removedTests.length > 0 ||
    otherChangesCount > 0;

  return {
    status: hasDiffs ? "available" : "empty",
    summaryLabel: hasDiffs
      ? `New failures ${formatNumber(newFailures.length)} • Still failing ${formatNumber(stillFailing.length)} • Newly passing ${formatNumber(newPasses.length)}`
      : "No high-signal test differences",
    detail:
      otherChangesCount > 0
        ? `${formatNumber(otherChangesCount)} additional test changes were not classified as failures or newly passing results.`
        : undefined,
    baselineSummaryLabel: buildTestSummaryLabel(baselineReport),
    targetSummaryLabel: buildTestSummaryLabel(targetReport),
    newFailures,
    stillFailing,
    newPasses,
    addedTests,
    removedTests,
    otherChangesCount,
    unchangedCount
  };
}

function buildTestSummaryLabel(result: BuildCompareOptionalResult<JenkinsTestReport>): string {
  if (result.status === "error") {
    return "Error";
  }
  if (result.status !== "available") {
    return "Unavailable";
  }
  return formatAvailableTestReportCountsSummary(result.value);
}

function buildTestCaseMap(report: JenkinsTestReport): Map<string, NormalizedTestCase> {
  const items = new Map<string, NormalizedTestCase>();
  const duplicateCounts = new Map<string, number>();
  forEachNormalizedTestCase(report, (testCase, { suiteName }) => {
    const normalized = normalizeTestCaseBase(testCase, suiteName);
    if (!normalized) {
      return;
    }
    const occurrence = duplicateCounts.get(normalized.key) ?? 0;
    duplicateCounts.set(normalized.key, occurrence + 1);
    const occurrenceKey = buildOccurrenceKey(normalized.key, occurrence);
    items.set(occurrenceKey, {
      ...normalized,
      key: occurrenceKey
    });
  });
  return items;
}

function buildTestDiffItem(
  baseline: NormalizedTestCase,
  target: NormalizedTestCase
): BuildCompareTestDiffItem {
  return {
    key: baseline.key,
    name: target.name,
    className: target.className,
    suiteName: target.suiteName,
    baselineStatusLabel: baseline.statusLabel,
    targetStatusLabel: target.statusLabel,
    baselineDurationLabel: baseline.durationLabel,
    targetDurationLabel: target.durationLabel
  };
}

function buildSingleSideTestDiffItem(
  testCase: NormalizedTestCase,
  side: "added" | "removed"
): BuildCompareTestDiffItem {
  return {
    key: testCase.key,
    name: testCase.name,
    className: testCase.className,
    suiteName: testCase.suiteName,
    baselineStatusLabel: side === "removed" ? testCase.statusLabel : "-",
    targetStatusLabel: side === "added" ? testCase.statusLabel : "-",
    baselineDurationLabel: side === "removed" ? testCase.durationLabel : undefined,
    targetDurationLabel: side === "added" ? testCase.durationLabel : undefined
  };
}

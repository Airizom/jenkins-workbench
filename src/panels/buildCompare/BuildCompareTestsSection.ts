import type { JenkinsTestReport, JenkinsTestReportCase } from "../../jenkins/types";
import { formatNumber } from "../buildDetails/BuildDetailsFormatters";
import { type NormalizedTestCaseBase, normalizeTestCaseBase } from "../shared/TestCaseViewModel";
import { formatTestReportCountsSummary } from "../shared/TestReportFormatters";
import { type BuildCompareOptionalResult, evaluateOptionalPair } from "./BuildCompareLoadState";
import { buildComparisonErrorDetail, normalizeString } from "./BuildCompareSectionShared";
import type {
  BuildCompareTestDiffItem,
  BuildCompareTestsSectionViewModel
} from "./shared/BuildCompareContracts";

type NormalizedTestCase = NormalizedTestCaseBase;

export function buildTestsSection(
  baselineReport: BuildCompareOptionalResult<JenkinsTestReport>,
  targetReport: BuildCompareOptionalResult<JenkinsTestReport>
): BuildCompareTestsSectionViewModel {
  return evaluateOptionalPair(baselineReport, targetReport, {
    onError: ({ baseline, target }) => ({
      status: "error",
      summaryLabel: "Test comparison unavailable",
      detail: buildComparisonErrorDetail("Test report", baseline, target),
      baselineSummaryLabel: buildTestSummaryLabel(baselineReport),
      targetSummaryLabel: buildTestSummaryLabel(targetReport),
      newFailures: [],
      stillFailing: [],
      newPasses: [],
      addedTests: [],
      removedTests: [],
      otherChangesCount: 0,
      unchangedCount: 0
    }),
    onBothUnavailable: () => ({
      status: "unavailable",
      summaryLabel: "Test report data unavailable",
      detail: "Neither build exposed a Jenkins test report.",
      baselineSummaryLabel: "Unavailable",
      targetSummaryLabel: "Unavailable",
      newFailures: [],
      stillFailing: [],
      newPasses: [],
      addedTests: [],
      removedTests: [],
      otherChangesCount: 0,
      unchangedCount: 0
    }),
    onPartialUnavailable: () => ({
      status: "unavailable",
      summaryLabel: "Test report data unavailable",
      detail: "Both builds need test report data for a reliable comparison.",
      baselineSummaryLabel: buildTestSummaryLabel(baselineReport),
      targetSummaryLabel: buildTestSummaryLabel(targetReport),
      newFailures: [],
      stillFailing: [],
      newPasses: [],
      addedTests: [],
      removedTests: [],
      otherChangesCount: 0,
      unchangedCount: 0
    }),
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
  const keys = [...new Set([...baselineCases.keys(), ...targetCases.keys()])].sort();
  const newFailures: BuildCompareTestDiffItem[] = [];
  const stillFailing: BuildCompareTestDiffItem[] = [];
  const newPasses: BuildCompareTestDiffItem[] = [];
  const addedTests: BuildCompareTestDiffItem[] = [];
  const removedTests: BuildCompareTestDiffItem[] = [];
  let otherChangesCount = 0;
  let unchangedCount = 0;

  for (const key of keys) {
    const baseline = baselineCases.get(key);
    const target = targetCases.get(key);
    if (!baseline && !target) {
      continue;
    }
    if (!baseline && target) {
      addedTests.push(buildSingleSideTestDiffItem(target, "added"));
      continue;
    }
    if (baseline && !target) {
      removedTests.push(buildSingleSideTestDiffItem(baseline, "removed"));
      continue;
    }
    if (baseline && target) {
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
  }

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
  return formatTestReportCountsSummary({
    failed: result.value.failCount,
    total: result.value.totalCount,
    skipped: result.value.skipCount
  });
}

function buildTestCaseMap(report: JenkinsTestReport): Map<string, NormalizedTestCase> {
  const items = new Map<string, NormalizedTestCase>();
  const duplicateCounts = new Map<string, number>();
  for (const suite of report.suites ?? []) {
    const suiteName = normalizeString(suite.name);
    for (const testCase of suite.cases ?? []) {
      const normalized = normalizeTestCase(testCase, suiteName);
      if (!normalized) {
        continue;
      }
      const occurrence = duplicateCounts.get(normalized.key) ?? 0;
      duplicateCounts.set(normalized.key, occurrence + 1);
      const occurrenceKey = buildTestCaseOccurrenceKey(normalized.key, occurrence);
      items.set(occurrenceKey, {
        ...normalized,
        key: occurrenceKey
      });
    }
  }
  return items;
}

function normalizeTestCase(
  testCase: JenkinsTestReportCase,
  suiteName: string | undefined
): NormalizedTestCase | undefined {
  return normalizeTestCaseBase(testCase, suiteName);
}

function buildTestCaseOccurrenceKey(key: string, occurrence: number): string {
  return `${key}::${occurrence}`;
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

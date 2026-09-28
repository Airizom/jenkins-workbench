import { formatNumber } from "../../formatters/DisplayFormatters";
import type { JenkinsTestReport } from "../../jenkins/types";
import {
  forEachNormalizedTestCase,
  type NormalizedTestCaseBase,
  normalizeTestCaseBase
} from "../shared/TestCaseViewModel";
import { formatAvailableTestReportCountsSummary } from "../shared/TestReportFormatters";
import { testStatusToVisualTone } from "../shared/TestStatusFormatters";
import { forEachKeyedDiff } from "./BuildCompareDiff";
import type { BuildCompareOptionalResult } from "./BuildCompareLoadState";
import { evaluateStandardCompareSection } from "./BuildCompareSectionShared";
import type {
  BuildCompareAmbiguousTestItem,
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
  | "otherChanges"
  | "ambiguousTests"
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
  | "otherChanges"
  | "ambiguousTests"
  | "unchangedCount"
> = {
  newFailures: [],
  stillFailing: [],
  newPasses: [],
  addedTests: [],
  removedTests: [],
  otherChanges: [],
  ambiguousTests: [],
  unchangedCount: 0
};

const UNAVAILABLE_TEST_SUMMARY_LABELS = {
  baselineSummaryLabel: "Unavailable",
  targetSummaryLabel: "Unavailable"
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
      ...UNAVAILABLE_TEST_SUMMARY_LABELS
    },
    resolveErrorFields: () => testSummaryFields,
    resolvePartialFields: () => testSummaryFields,
    onAvailable: (baselineValue, targetValue) =>
      buildAvailableTestsSection(baselineValue, targetValue)
  });
}

function buildAvailableTestsSection(
  baselineValue: JenkinsTestReport,
  targetValue: JenkinsTestReport
): BuildCompareTestsSectionViewModel {
  const baselineGroups = groupTestCases(baselineValue);
  const targetGroups = groupTestCases(targetValue);
  const newFailures: BuildCompareTestDiffItem[] = [];
  const stillFailing: BuildCompareTestDiffItem[] = [];
  const newPasses: BuildCompareTestDiffItem[] = [];
  const addedTests: BuildCompareTestDiffItem[] = [];
  const removedTests: BuildCompareTestDiffItem[] = [];
  const otherChanges: BuildCompareTestDiffItem[] = [];
  const ambiguousTests: BuildCompareAmbiguousTestItem[] = [];
  let unchangedCount = 0;

  const collectAmbiguous = (
    key: string,
    baseline: NormalizedTestCase[],
    target: NormalizedTestCase[]
  ): boolean => {
    if (baseline.length <= 1 && target.length <= 1) {
      return false;
    }
    ambiguousTests.push(buildAmbiguousTestItem(key, baseline, target));
    return true;
  };

  forEachKeyedDiff(baselineGroups, targetGroups, {
    onAdded: (key, targetCases) => {
      if (collectAmbiguous(key, [], targetCases)) {
        return;
      }
      const [target] = targetCases;
      if (!target) {
        return;
      }
      const item = buildSingleSideTestDiffItem(target, "added");
      // A test that first appears already failing is a regression in the target build.
      if (target.status === "failed") {
        newFailures.push({ ...item, addedInTarget: true });
      } else {
        addedTests.push(item);
      }
    },
    onRemoved: (key, baselineCases) => {
      if (collectAmbiguous(key, baselineCases, [])) {
        return;
      }
      const [baseline] = baselineCases;
      if (baseline) {
        removedTests.push(buildSingleSideTestDiffItem(baseline, "removed"));
      }
    },
    onBoth: (key, baselineCases, targetCases) => {
      if (collectAmbiguous(key, baselineCases, targetCases)) {
        return;
      }
      const [baseline] = baselineCases;
      const [target] = targetCases;
      if (!baseline || !target) {
        return;
      }
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
        otherChanges.push(item);
      }
    }
  });

  const hasDiffs =
    newFailures.length > 0 ||
    stillFailing.length > 0 ||
    newPasses.length > 0 ||
    addedTests.length > 0 ||
    removedTests.length > 0 ||
    otherChanges.length > 0 ||
    ambiguousTests.length > 0;

  return {
    status: hasDiffs ? "available" : "empty",
    summaryLabel: hasDiffs
      ? formatTestDiffSummary(
          newFailures.length,
          stillFailing.length,
          newPasses.length,
          ambiguousTests.length
        )
      : "No high-signal test differences",
    baselineSummaryLabel: formatAvailableTestReportCountsSummary(baselineValue),
    targetSummaryLabel: formatAvailableTestReportCountsSummary(targetValue),
    newFailures,
    stillFailing,
    newPasses,
    addedTests,
    removedTests,
    otherChanges,
    ambiguousTests,
    unchangedCount
  };
}

function formatTestDiffSummary(
  newFailureCount: number,
  stillFailingCount: number,
  newPassCount: number,
  ambiguousCount: number
): string {
  const parts = [
    `New failures ${formatNumber(newFailureCount)}`,
    `Still failing ${formatNumber(stillFailingCount)}`,
    `Newly passing ${formatNumber(newPassCount)}`
  ];
  if (ambiguousCount > 0) {
    parts.push(`${formatNumber(ambiguousCount)} ambiguous`);
  }
  return parts.join(" · ");
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

/**
 * Groups test cases by suite/class/name identity. Identities with more than one
 * case on either side are reported as ambiguous instead of being paired by
 * position, which could otherwise fabricate passes, failures, or removals.
 */
function groupTestCases(report: JenkinsTestReport): Map<string, NormalizedTestCase[]> {
  const groups = new Map<string, NormalizedTestCase[]>();
  forEachNormalizedTestCase(report, (testCase, { suiteName }) => {
    const normalized = normalizeTestCaseBase(testCase, suiteName);
    if (!normalized) {
      return;
    }
    const group = groups.get(normalized.key);
    if (group) {
      group.push(normalized);
    } else {
      groups.set(normalized.key, [normalized]);
    }
  });
  return groups;
}

function buildAmbiguousTestItem(
  key: string,
  baseline: NormalizedTestCase[],
  target: NormalizedTestCase[]
): BuildCompareAmbiguousTestItem {
  const representative = target[0] ?? baseline[0];
  return {
    key,
    name: representative?.name ?? "Unnamed test",
    className: representative?.className,
    suiteName: representative?.suiteName,
    baselineStatusLabels: baseline.map((testCase) => testCase.statusLabel),
    targetStatusLabels: target.map((testCase) => testCase.statusLabel)
  };
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
    baselineStatusTone: testStatusToVisualTone(baseline.status),
    targetStatusTone: testStatusToVisualTone(target.status),
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
    baselineStatusTone: side === "removed" ? testStatusToVisualTone(testCase.status) : undefined,
    targetStatusTone: side === "added" ? testStatusToVisualTone(testCase.status) : undefined,
    baselineDurationLabel: side === "removed" ? testCase.durationLabel : undefined,
    targetDurationLabel: side === "added" ? testCase.durationLabel : undefined
  };
}

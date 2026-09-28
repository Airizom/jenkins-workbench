import type { JenkinsChangesetViewModel } from "../../../jenkins/changesets/JenkinsChangesetViewModel";
import type { BuildHeaderViewModel } from "../../../shared/build/BuildHeaderLabels";
import type { StatusVisualTone } from "../../shared/TestStatusStyles";

export const compareSectionStatuses = [
  "loading",
  "available",
  "empty",
  "unavailable",
  "error",
  "tooLarge",
  "identical"
] as const;

export type CompareSectionStatus = (typeof compareSectionStatuses)[number];

export interface CompareSectionBaseViewModel {
  status: CompareSectionStatus;
  summaryLabel: string;
  detail?: string;
}

export interface BuildCompareBuildViewModel extends BuildHeaderViewModel {
  roleLabel: string;
  /** Jenkins full display name, e.g. "web-app » main #1482". */
  displayName: string;
  /** Always "#<number>" so the build stays identifiable when names truncate. */
  buildNumberLabel: string;
  /** Job path without the build suffix, e.g. "web-app » main". */
  jobDisplayName?: string;
  buildUrl: string;
}

export interface BuildCompareTestDiffItem {
  key: string;
  name: string;
  className?: string;
  suiteName?: string;
  baselineStatusLabel: string;
  targetStatusLabel: string;
  baselineStatusTone?: StatusVisualTone;
  targetStatusTone?: StatusVisualTone;
  baselineDurationLabel?: string;
  targetDurationLabel?: string;
  /** True when the test only exists in the target build (listed under new failures when failing). */
  addedInTarget?: boolean;
}

/**
 * A suite/class/name identity that occurs more than once in at least one build.
 * Such tests cannot be paired reliably, so they are never counted as passing,
 * failing, added, or removed. An empty label list means the identity is absent
 * from that build.
 */
export interface BuildCompareAmbiguousTestItem {
  key: string;
  name: string;
  className?: string;
  suiteName?: string;
  baselineStatusLabels: string[];
  targetStatusLabels: string[];
}

export interface BuildCompareTestsSectionViewModel extends CompareSectionBaseViewModel {
  baselineSummaryLabel: string;
  targetSummaryLabel: string;
  newFailures: BuildCompareTestDiffItem[];
  stillFailing: BuildCompareTestDiffItem[];
  newPasses: BuildCompareTestDiffItem[];
  addedTests: BuildCompareTestDiffItem[];
  removedTests: BuildCompareTestDiffItem[];
  /** Status changes that are neither failures nor newly passing, e.g. failed → skipped. */
  otherChanges: BuildCompareTestDiffItem[];
  ambiguousTests: BuildCompareAmbiguousTestItem[];
  unchangedCount: number;
}

export interface BuildCompareParameterDiffItem {
  name: string;
  changeType: "added" | "removed" | "changed";
  baselineValue?: string;
  targetValue?: string;
}

export interface BuildCompareParametersSectionViewModel extends CompareSectionBaseViewModel {
  items: BuildCompareParameterDiffItem[];
  unchangedCount: number;
}

export type BuildCompareChangesetItem = JenkinsChangesetViewModel;

export interface BuildCompareChangesetsSectionViewModel extends CompareSectionBaseViewModel {
  baselineItems: BuildCompareChangesetItem[];
  targetItems: BuildCompareChangesetItem[];
}

export interface BuildCompareStageDiffItem {
  key: string;
  name: string;
  changeType: "matched" | "added" | "removed";
  baselineStatusLabel?: string;
  targetStatusLabel?: string;
  baselineStatusClass?: string;
  targetStatusClass?: string;
  baselineDurationLabel?: string;
  targetDurationLabel?: string;
  deltaLabel?: string;
  deltaDirection?: BuildCompareStageDeltaDirection;
  /** True when the timing delta crosses the stage regression/improvement threshold. */
  deltaSignificant?: boolean;
}

export type BuildCompareStageDeltaDirection = "slower" | "faster";

export interface BuildCompareStagesSectionViewModel extends CompareSectionBaseViewModel {
  items: BuildCompareStageDiffItem[];
}

export interface BuildCompareConsoleSnippetLine {
  lineNumber: number;
  text: string;
  highlight: boolean;
}

export interface BuildCompareConsoleSectionViewModel extends CompareSectionBaseViewModel {
  divergenceLineLabel?: string;
  baselineLines: BuildCompareConsoleSnippetLine[];
  targetLines: BuildCompareConsoleSnippetLine[];
}

export interface BuildCompareViewModel {
  title: string;
  baseline: BuildCompareBuildViewModel;
  target: BuildCompareBuildViewModel;
  tests: BuildCompareTestsSectionViewModel;
  parameters: BuildCompareParametersSectionViewModel;
  changesets: BuildCompareChangesetsSectionViewModel;
  stages: BuildCompareStagesSectionViewModel;
  console: BuildCompareConsoleSectionViewModel;
  errors: string[];
}

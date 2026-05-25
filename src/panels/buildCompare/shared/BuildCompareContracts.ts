import type { JenkinsChangesetViewModel } from "../../../jenkins/changesets/JenkinsChangesetViewModel";
import type { BuildHeaderViewModel } from "../../../shared/build/BuildHeaderLabels";

export type CompareSectionStatus =
  | "loading"
  | "available"
  | "empty"
  | "unavailable"
  | "error"
  | "tooLarge"
  | "identical";

export interface CompareSectionBaseViewModel {
  status: CompareSectionStatus;
  summaryLabel: string;
  detail?: string;
}

export interface BuildCompareBuildViewModel extends BuildHeaderViewModel {
  roleLabel: string;
  displayName: string;
  buildUrl: string;
}

export interface BuildCompareTestDiffItem {
  key: string;
  name: string;
  className?: string;
  suiteName?: string;
  baselineStatusLabel: string;
  targetStatusLabel: string;
  baselineDurationLabel?: string;
  targetDurationLabel?: string;
}

export interface BuildCompareTestsSectionViewModel extends CompareSectionBaseViewModel {
  baselineSummaryLabel: string;
  targetSummaryLabel: string;
  newFailures: BuildCompareTestDiffItem[];
  stillFailing: BuildCompareTestDiffItem[];
  newPasses: BuildCompareTestDiffItem[];
  addedTests: BuildCompareTestDiffItem[];
  removedTests: BuildCompareTestDiffItem[];
  otherChangesCount: number;
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
  name: string;
  changeType: "matched" | "added" | "removed";
  baselineStatusLabel?: string;
  targetStatusLabel?: string;
  baselineStatusClass?: string;
  targetStatusClass?: string;
  baselineDurationLabel?: string;
  targetDurationLabel?: string;
  deltaLabel?: string;
}

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

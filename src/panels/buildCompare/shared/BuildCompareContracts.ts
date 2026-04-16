export type CompareSectionStatus =
  | "loading"
  | "available"
  | "empty"
  | "unavailable"
  | "error"
  | "tooLarge"
  | "identical";

export interface BuildCompareBuildViewModel {
  roleLabel: string;
  displayName: string;
  buildUrl: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
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

export interface BuildCompareTestsSectionViewModel {
  status: CompareSectionStatus;
  summaryLabel: string;
  detail?: string;
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

export interface BuildCompareParametersSectionViewModel {
  status: CompareSectionStatus;
  summaryLabel: string;
  detail?: string;
  items: BuildCompareParameterDiffItem[];
  unchangedCount: number;
}

export interface BuildCompareChangesetItem {
  message: string;
  author: string;
  commitId?: string;
}

export interface BuildCompareChangesetsSectionViewModel {
  status: CompareSectionStatus;
  summaryLabel: string;
  detail?: string;
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

export interface BuildCompareStagesSectionViewModel {
  status: CompareSectionStatus;
  summaryLabel: string;
  detail?: string;
  items: BuildCompareStageDiffItem[];
}

export interface BuildCompareConsoleSnippetLine {
  lineNumber: number;
  text: string;
  highlight: boolean;
}

export interface BuildCompareConsoleSectionViewModel {
  status: CompareSectionStatus;
  summaryLabel: string;
  detail?: string;
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

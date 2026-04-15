export interface BuildFailureChangelogItem {
  message: string;
  author: string;
  commitId?: string;
}

export interface BuildFailureArtifact {
  name: string;
  fileName?: string;
  relativePath: string;
}

export type ArtifactAction = "preview" | "download";

export interface PipelineStageStepViewModel {
  name: string;
  statusLabel: string;
  statusClass: string;
  durationLabel: string;
}

export interface PipelineStageViewModel {
  key: string;
  name: string;
  statusLabel: string;
  statusClass: string;
  durationLabel: string;
  durationMs?: number;
  canRestartFromStage: boolean;
  hasSteps: boolean;
  stepsFailedOnly: PipelineStageStepViewModel[];
  stepsAll: PipelineStageStepViewModel[];
  parallelBranches: PipelineStageViewModel[];
}

export interface BuildFailureInsightsViewModel {
  changelogItems: BuildFailureChangelogItem[];
  changelogOverflow: number;
  testSummaryLabel: string;
  testResultsHint?: string;
  artifacts: BuildFailureArtifact[];
  artifactsOverflow: number;
}

export type TestResultStatus = "passed" | "failed" | "skipped" | "other";

export interface BuildTestsSummaryViewModel {
  totalCount: number;
  failedCount: number;
  skippedCount: number;
  passedCount: number;
  summaryLabel: string;
  hasAnyResults: boolean;
  hasDetailedResults: boolean;
  detailsUnavailable: boolean;
  logsIncluded: boolean;
  canLoadLogs: boolean;
}

export interface BuildTestCaseViewModel {
  id: string;
  name: string;
  className?: string;
  suiteName?: string;
  status: TestResultStatus;
  statusLabel: string;
  durationLabel?: string;
  errorDetails?: string;
  errorStackTrace?: string;
  stdout?: string;
  stderr?: string;
  canOpenSource: boolean;
}

export interface BuildTestResultsViewModel {
  items: BuildTestCaseViewModel[];
  loading: boolean;
}

export interface BuildDetailsTestStateViewModel {
  summary: BuildTestsSummaryViewModel;
  results: BuildTestResultsViewModel;
}

export interface BuildCoverageQualityGateViewModel {
  name: string;
  statusLabel: string;
  statusClass: string;
  thresholdLabel?: string;
  valueLabel?: string;
}

export interface BuildCoverageFileViewModel {
  path: string;
  coveredCount: number;
  missedCount: number;
  partialCount: number;
}

export interface BuildDetailsCoverageStateViewModel {
  status: "disabled" | "idle" | "loading" | "unavailable" | "error" | "available";
  showTab: boolean;
  projectCoverage?: string;
  modifiedFilesCoverage?: string;
  modifiedLinesCoverage?: string;
  overallQualityGateStatusLabel?: string;
  overallQualityGateStatusClass?: string;
  qualityGates: BuildCoverageQualityGateViewModel[];
  modifiedFiles: BuildCoverageFileViewModel[];
  summaryOnly: boolean;
  errorMessage?: string;
}

export interface PendingInputParameterViewModel {
  name: string;
  kind: string;
  description?: string;
  choices?: string[];
  defaultValue?: string | number | boolean | string[];
}

export interface PendingInputViewModel {
  id: string;
  message: string;
  submitterLabel: string;
  parametersLabel: string;
  parameters: PendingInputParameterViewModel[];
}

export interface BuildDetailsViewModel {
  displayName: string;
  buildUrl?: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  pipelineStagesLoading: boolean;
  pipelineStages: PipelineStageViewModel[];
  testState: BuildDetailsTestStateViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  pendingInputs: PendingInputViewModel[];
  consoleText: string;
  consoleHtml?: string;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  errors: string[];
  followLog: boolean;
  loading?: boolean;
}

export interface BuildDetailsUpdateMessage {
  type: "updateDetails";
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  pipelineStagesLoading: boolean;
  testState: BuildDetailsTestStateViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  pipelineStages: PipelineStageViewModel[];
  pendingInputs: PendingInputViewModel[];
}

export interface BuildFailureChangelogItem {
  message: string;
  author: string;
  commitId?: string;
}

export interface BuildFailureFailedTest {
  name: string;
  className?: string;
  errorDetails?: string;
  errorStackTrace?: string;
  stdout?: string;
  stderr?: string;
  durationLabel?: string;
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
  hasSteps: boolean;
  stepsFailedOnly: PipelineStageStepViewModel[];
  stepsAll: PipelineStageStepViewModel[];
  parallelBranches: PipelineStageViewModel[];
}

export interface BuildFailureInsightsViewModel {
  changelogItems: BuildFailureChangelogItem[];
  changelogOverflow: number;
  testSummaryLabel: string;
  failedTests: BuildFailureFailedTest[];
  failedTestsOverflow: number;
  failedTestsMessage: string;
  artifacts: BuildFailureArtifact[];
  artifactsOverflow: number;
}

export interface PendingInputParameterViewModel {
  name: string;
  kind: string;
  description?: string;
  choices?: string[];
  defaultValue?: string | number | boolean;
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
  insights: BuildFailureInsightsViewModel;
  pipelineStages: PipelineStageViewModel[];
  pendingInputs: PendingInputViewModel[];
}

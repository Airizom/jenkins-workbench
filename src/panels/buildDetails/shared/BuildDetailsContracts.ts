export interface BuildFailureChangelogItem {
  message: string;
  author: string;
  commitId?: string;
}

export interface BuildFailureFailedTest {
  name: string;
  className?: string;
}

export interface BuildFailureArtifact {
  name: string;
  fileName?: string;
  relativePath: string;
}

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

export interface BuildDetailsViewModel {
  displayName: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  pipelineStages: PipelineStageViewModel[];
  insights: BuildFailureInsightsViewModel;
  consoleText: string;
  consoleHtml?: string;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  errors: string[];
  followLog: boolean;
}

export interface BuildDetailsUpdateMessage {
  type: "updateDetails";
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  insights: BuildFailureInsightsViewModel;
  pipelineStages: PipelineStageViewModel[];
}

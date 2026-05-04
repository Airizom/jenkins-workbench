import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { PipelineRun } from "../../jenkins/pipeline/PipelineTypes";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsTestReport
} from "../../jenkins/types";
import { buildCoverageStateViewModel } from "./BuildDetailsCoverageViewModel";
import { buildBuildFailureInsights } from "./BuildDetailsFailureInsightsViewModel";
import {
  formatCulprits,
  formatDuration,
  formatResult,
  formatResultClass,
  formatTimestamp,
  truncateConsoleText
} from "./BuildDetailsFormatters";
import { buildPendingInputsViewModel } from "./BuildDetailsPendingInputsViewModel";
import { buildPipelineStagesViewModel } from "./BuildDetailsPipelineViewModel";
import { buildTestStateViewModel } from "./BuildDetailsTestsViewModel";
import type { BuildDetailsViewModel } from "./shared/BuildDetailsContracts";
import type { PipelineNodeLogViewModel } from "./shared/BuildDetailsContracts";

export type {
  BuildCoverageFileViewModel,
  BuildCoverageQualityGateViewModel,
  BuildDetailsCoverageStateViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildDetailsTestStateViewModel,
  BuildTestsSummaryViewModel,
  BuildDetailsViewModel,
  BuildFailureArtifact,
  BuildFailureChangelogItem,
  BuildFailureInsightsViewModel,
  PendingInputParameterViewModel,
  PendingInputViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "./shared/BuildDetailsContracts";

export { buildCoverageStateViewModel } from "./BuildDetailsCoverageViewModel";
export { buildBuildFailureInsights } from "./BuildDetailsFailureInsightsViewModel";
export { buildPendingInputsViewModel } from "./BuildDetailsPendingInputsViewModel";
export { buildPipelineStagesViewModel } from "./BuildDetailsPipelineViewModel";
export {
  buildEmptyTestResultsViewModel,
  buildTestResultsViewModel,
  buildTestsSummary,
  buildTestStateViewModel
} from "./BuildDetailsTestsViewModel";

export interface BuildDetailsViewModelInput {
  details?: JenkinsBuildDetails;
  buildUrl?: string;
  pipelineRun?: PipelineRun;
  pipelineLoading?: boolean;
  testReport?: JenkinsTestReport;
  testReportFetched?: boolean;
  testReportLogsIncluded?: boolean;
  coverageOverview?: JenkinsCoverageOverview;
  modifiedCoverageFiles?: JenkinsModifiedCoverageFile[];
  coverageActionPath?: string;
  coverageFetched?: boolean;
  coverageLoading?: boolean;
  coverageError?: string;
  coverageEnabled?: boolean;
  consoleTextResult?: JenkinsConsoleText;
  consoleHtmlResult?: { html: string; truncated: boolean };
  consoleError?: string;
  errors: string[];
  maxConsoleChars: number;
  followLog?: boolean;
  pendingInputs?: PendingInputAction[];
  pipelineRestartEnabled?: boolean;
  pipelineRestartableStages?: string[];
  pipelineNodeLog?: PipelineNodeLogViewModel;
  testResultsLoading?: boolean;
  canOpenTestSource?: (className?: string) => boolean;
}

export function buildBuildDetailsViewModel(
  input: BuildDetailsViewModelInput
): BuildDetailsViewModel {
  const details = input.details;
  const buildUrl = details?.url ?? input.buildUrl;
  const testState = buildTestStateViewModel(details, input.testReport, {
    testReportFetched: input.testReportFetched,
    logsIncluded: input.testReportLogsIncluded,
    loading: input.testResultsLoading,
    canOpenSource: input.canOpenTestSource
  });
  const coverageState = buildCoverageStateViewModel(details, input.coverageOverview, {
    modifiedFiles: input.modifiedCoverageFiles,
    actionPath: input.coverageActionPath,
    coverageFetched: input.coverageFetched,
    loading: input.coverageLoading,
    error: input.coverageError,
    enabled: input.coverageEnabled
  });
  const truncated = truncateConsoleText(input.consoleTextResult?.text ?? "", input.maxConsoleChars);
  const consoleTruncated =
    Boolean(input.consoleHtmlResult?.truncated) ||
    truncated.truncated ||
    Boolean(input.consoleTextResult?.truncated);
  const nonConsoleErrors = input.errors.filter(
    (error) => !error.toLowerCase().startsWith("console output:")
  );
  const consoleError = input.consoleError ?? extractConsoleError(input.errors);

  return {
    displayName: details?.fullDisplayName ?? details?.displayName ?? "Build Details",
    buildUrl,
    resultLabel: details ? formatResult(details) : "Unknown",
    resultClass: details ? formatResultClass(details) : "neutral",
    durationLabel: details ? formatDuration(details.duration) : "Unknown",
    timestampLabel: details ? formatTimestamp(details.timestamp) : "Unknown",
    culpritsLabel: details ? formatCulprits(details.culprits) : "Unknown",
    pipelineStagesLoading: Boolean(input.pipelineLoading),
    pipelineStages: buildPipelineStagesViewModel(input.pipelineRun, {
      details,
      restartEnabled: Boolean(input.pipelineRestartEnabled),
      restartableStages: input.pipelineRestartableStages ?? []
    }),
    pipelineNodeLog: input.pipelineNodeLog ?? {
      text: "",
      truncated: false,
      loading: false
    },
    testState,
    coverageState,
    insights: buildBuildFailureInsights(details, testState.summary),
    pendingInputs: buildPendingInputsViewModel(input.pendingInputs),
    consoleText: truncated.text,
    consoleHtml: input.consoleHtmlResult?.html,
    consoleTruncated,
    consoleMaxChars: input.maxConsoleChars,
    consoleError,
    errors: nonConsoleErrors,
    followLog: input.followLog ?? true
  };
}

function extractConsoleError(errors: string[]): string | undefined {
  const consoleError = errors.find((error) => error.toLowerCase().startsWith("console output:"));
  if (consoleError) {
    return consoleError.replace(/^console output:\s*/i, "");
  }
  return undefined;
}

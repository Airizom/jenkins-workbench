import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { PipelineRun } from "../../jenkins/pipeline/PipelineTypes";
import type { JenkinsBuildDetails, JenkinsTestReport } from "../../jenkins/types";
import {
  formatCulprits,
  formatDuration,
  formatResult,
  formatResultClass,
  formatTimestamp
} from "./BuildDetailsFormatters";
import type { BuildDetailsOutgoingMessage } from "./BuildDetailsMessages";
import type { BuildDetailsUpdateMessage } from "./BuildDetailsMessages";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import {
  buildCoverageStateViewModel,
  buildTestStateViewModel,
  buildTestsSummary
} from "./BuildDetailsViewModel";
import {
  buildBuildFailureInsights,
  buildPendingInputsViewModel,
  buildPipelineStagesViewModel
} from "./BuildDetailsViewModel";
import type { PipelineNodeLogViewModel } from "./shared/BuildDetailsContracts";

export function buildDetailsUpdateMessage(
  details: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  options?: {
    testReportFetched?: boolean;
    testReportLogsIncluded?: boolean;
    testResultsLoading?: boolean;
    coverageOverview?: JenkinsCoverageOverview;
    modifiedCoverageFiles?: JenkinsModifiedCoverageFile[];
    coverageActionPath?: string;
    coverageFetched?: boolean;
    coverageLoading?: boolean;
    coverageError?: string;
    coverageEnabled?: boolean;
    canOpenSource?: (className?: string) => boolean;
  },
  pipelineRun?: PipelineRun,
  pendingInputs?: PendingInputAction[],
  pipelineLoading?: boolean,
  pipelineRestartEnabled?: boolean,
  pipelineRestartableStages?: string[],
  pipelineNodeLog?: PipelineNodeLogViewModel
): BuildDetailsUpdateMessage {
  const testsSummary = buildTestsSummary(details, testReport, {
    testReportFetched: options?.testReportFetched,
    logsIncluded: options?.testReportLogsIncluded
  });
  return {
    type: "updateDetails",
    resultLabel: formatResult(details),
    resultClass: formatResultClass(details),
    durationLabel: formatDuration(details.duration),
    timestampLabel: formatTimestamp(details.timestamp),
    culpritsLabel: formatCulprits(details.culprits),
    pipelineStagesLoading: Boolean(pipelineLoading),
    testState: buildTestStateViewModel(details, testReport, {
      testReportFetched: options?.testReportFetched,
      logsIncluded: options?.testReportLogsIncluded,
      loading: options?.testResultsLoading,
      canOpenSource: options?.canOpenSource
    }),
    coverageState: buildCoverageStateViewModel(details, options?.coverageOverview, {
      modifiedFiles: options?.modifiedCoverageFiles,
      actionPath: options?.coverageActionPath,
      coverageFetched: options?.coverageFetched,
      loading: options?.coverageLoading,
      error: options?.coverageError,
      enabled: options?.coverageEnabled
    }),
    insights: buildBuildFailureInsights(details, testsSummary),
    pipelineStages: buildPipelineStagesViewModel(pipelineRun, {
      details,
      restartEnabled: Boolean(pipelineRestartEnabled),
      restartableStages: pipelineRestartableStages ?? []
    }),
    pipelineNodeLog: pipelineNodeLog ?? {
      text: "",
      truncated: false,
      loading: false
    },
    pendingInputs: buildPendingInputsViewModel(pendingInputs)
  };
}

export function buildUpdateMessageFromState(
  state: BuildDetailsPanelState,
  options?: { canOpenSource?: (className?: string) => boolean; coverageEnabled?: boolean }
): BuildDetailsOutgoingMessage | undefined {
  if (state.currentDetails) {
    return buildDetailsUpdateMessage(
      state.currentDetails,
      state.currentTestReport,
      {
        testReportFetched: state.testReportFetched,
        testReportLogsIncluded: state.testReportLogsIncluded,
        testResultsLoading: state.testResultsLoading,
        coverageOverview: state.currentCoverageOverview,
        modifiedCoverageFiles: state.currentModifiedCoverageFiles,
        coverageActionPath: state.currentCoverageActionPath,
        coverageFetched: state.coverageFetched,
        coverageLoading: state.coverageLoading,
        coverageError: state.currentCoverageError,
        coverageEnabled: options?.coverageEnabled,
        canOpenSource: options?.canOpenSource
      },
      state.currentPipelineRun,
      state.currentPendingInputs,
      state.pipelineLoading,
      state.pipelineRestartEnabled,
      state.pipelineRestartableStages,
      state.pipelineNodeLog
    );
  }

  return {
    type: "updateDetails",
    resultLabel: "Unknown",
    resultClass: "neutral",
    durationLabel: "Unknown",
    timestampLabel: "Unknown",
    culpritsLabel: "Unknown",
    testState: buildTestStateViewModel(undefined, undefined, {
      loading: state.testResultsLoading,
      canOpenSource: options?.canOpenSource
    }),
    coverageState: buildCoverageStateViewModel(undefined, state.currentCoverageOverview, {
      modifiedFiles: state.currentModifiedCoverageFiles,
      actionPath: state.currentCoverageActionPath,
      coverageFetched: state.coverageFetched,
      loading: state.coverageLoading,
      error: state.currentCoverageError,
      enabled: options?.coverageEnabled
    }),
    insights: buildBuildFailureInsights(undefined),
    pipelineStages: buildPipelineStagesViewModel(state.currentPipelineRun, {
      details: state.currentDetails,
      restartEnabled: state.pipelineRestartEnabled,
      restartableStages: state.pipelineRestartableStages
    }),
    pipelineNodeLog: state.pipelineNodeLog,
    pendingInputs: buildPendingInputsViewModel(state.currentPendingInputs),
    pipelineStagesLoading: state.pipelineLoading
  };
}

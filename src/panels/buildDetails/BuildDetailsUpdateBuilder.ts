import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
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
import { buildTestStateViewModel, buildTestsSummary } from "./BuildDetailsViewModel";
import {
  buildBuildFailureInsights,
  buildPendingInputsViewModel,
  buildPipelineStagesViewModel
} from "./BuildDetailsViewModel";

export function buildDetailsUpdateMessage(
  details: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  options?: {
    testReportFetched?: boolean;
    testReportLogsIncluded?: boolean;
    testResultsLoading?: boolean;
    canOpenSource?: (className?: string) => boolean;
  },
  pipelineRun?: PipelineRun,
  pendingInputs?: PendingInputAction[],
  pipelineLoading?: boolean,
  pipelineRestartEnabled?: boolean,
  pipelineRestartableStages?: string[]
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
    insights: buildBuildFailureInsights(details, testsSummary),
    pipelineStages: buildPipelineStagesViewModel(pipelineRun, {
      details,
      restartEnabled: Boolean(pipelineRestartEnabled),
      restartableStages: pipelineRestartableStages ?? []
    }),
    pendingInputs: buildPendingInputsViewModel(pendingInputs)
  };
}

export function buildUpdateMessageFromState(
  state: BuildDetailsPanelState,
  options?: { canOpenSource?: (className?: string) => boolean }
): BuildDetailsOutgoingMessage | undefined {
  if (state.currentDetails) {
    return buildDetailsUpdateMessage(
      state.currentDetails,
      state.currentTestReport,
      {
        testReportFetched: state.testReportFetched,
        testReportLogsIncluded: state.testReportLogsIncluded,
        testResultsLoading: state.testResultsLoading,
        canOpenSource: options?.canOpenSource
      },
      state.currentPipelineRun,
      state.currentPendingInputs,
      state.pipelineLoading,
      state.pipelineRestartEnabled,
      state.pipelineRestartableStages
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
    insights: buildBuildFailureInsights(undefined),
    pipelineStages: buildPipelineStagesViewModel(state.currentPipelineRun, {
      details: state.currentDetails,
      restartEnabled: state.pipelineRestartEnabled,
      restartableStages: state.pipelineRestartableStages
    }),
    pendingInputs: buildPendingInputsViewModel(state.currentPendingInputs),
    pipelineStagesLoading: state.pipelineLoading
  };
}

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
import {
  buildBuildFailureInsights,
  buildPendingInputsViewModel,
  buildPipelineStagesViewModel
} from "./BuildDetailsViewModel";

export function buildDetailsUpdateMessage(
  details: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  pipelineRun?: PipelineRun,
  pendingInputs?: PendingInputAction[],
  pipelineLoading?: boolean,
  pipelineRestartEnabled?: boolean,
  pipelineRestartableStages?: string[]
): BuildDetailsUpdateMessage {
  return {
    type: "updateDetails",
    resultLabel: formatResult(details),
    resultClass: formatResultClass(details),
    durationLabel: formatDuration(details.duration),
    timestampLabel: formatTimestamp(details.timestamp),
    culpritsLabel: formatCulprits(details.culprits),
    pipelineStagesLoading: Boolean(pipelineLoading),
    insights: buildBuildFailureInsights(details, testReport),
    pipelineStages: buildPipelineStagesViewModel(pipelineRun, {
      details,
      restartEnabled: Boolean(pipelineRestartEnabled),
      restartableStages: pipelineRestartableStages ?? []
    }),
    pendingInputs: buildPendingInputsViewModel(pendingInputs)
  };
}

export function buildUpdateMessageFromState(
  state: BuildDetailsPanelState
): BuildDetailsOutgoingMessage | undefined {
  if (state.currentDetails) {
    return buildDetailsUpdateMessage(
      state.currentDetails,
      state.currentTestReport,
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
    insights: buildBuildFailureInsights(undefined, state.currentTestReport),
    pipelineStages: buildPipelineStagesViewModel(state.currentPipelineRun, {
      details: state.currentDetails,
      restartEnabled: state.pipelineRestartEnabled,
      restartableStages: state.pipelineRestartableStages
    }),
    pendingInputs: buildPendingInputsViewModel(state.currentPendingInputs),
    pipelineStagesLoading: state.pipelineLoading
  };
}

import type { PipelineRun } from "../../jenkins/pipeline/PipelineTypes";
import type { JenkinsBuildDetails, JenkinsTestReport } from "../../jenkins/types";
import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import {
  formatCulprits,
  formatDuration,
  formatResult,
  formatResultClass,
  formatTimestamp
} from "./BuildDetailsFormatters";
import type { BuildDetailsUpdateMessage } from "./BuildDetailsMessages";
import {
  buildBuildFailureInsights,
  buildPendingInputsViewModel,
  buildPipelineStagesViewModel
} from "./BuildDetailsViewModel";

export function buildDetailsUpdateMessage(
  details: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  pipelineRun?: PipelineRun,
  pendingInputs?: PendingInputAction[]
): BuildDetailsUpdateMessage {
  return {
    type: "updateDetails",
    resultLabel: formatResult(details),
    resultClass: formatResultClass(details),
    durationLabel: formatDuration(details.duration),
    timestampLabel: formatTimestamp(details.timestamp),
    culpritsLabel: formatCulprits(details.culprits),
    insights: buildBuildFailureInsights(details, testReport),
    pipelineStages: buildPipelineStagesViewModel(pipelineRun),
    pendingInputs: buildPendingInputsViewModel(pendingInputs)
  };
}

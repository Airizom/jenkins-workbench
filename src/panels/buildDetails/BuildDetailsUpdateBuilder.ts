import type { PipelineRun } from "../../jenkins/pipeline/PipelineTypes";
import type { JenkinsBuildDetails, JenkinsTestReport } from "../../jenkins/types";
import {
  formatCulprits,
  formatDuration,
  formatResult,
  formatResultClass,
  formatTimestamp
} from "./BuildDetailsFormatters";
import type { BuildDetailsUpdateMessage } from "./BuildDetailsMessages";
import { buildBuildFailureInsights, buildPipelineStagesViewModel } from "./BuildDetailsViewModel";

export function buildDetailsUpdateMessage(
  details: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  pipelineRun?: PipelineRun
): BuildDetailsUpdateMessage {
  return {
    type: "updateDetails",
    resultLabel: formatResult(details),
    resultClass: formatResultClass(details),
    durationLabel: formatDuration(details.duration),
    timestampLabel: formatTimestamp(details.timestamp),
    culpritsLabel: formatCulprits(details.culprits),
    insights: buildBuildFailureInsights(details, testReport),
    pipelineStages: buildPipelineStagesViewModel(pipelineRun)
  };
}

import type { JenkinsBuildDataOperations } from "./data/JenkinsBuildDataOperations";
import type { JenkinsCoverageDataOperations } from "./data/JenkinsCoverageDataOperations";
import type { JenkinsPendingInputDataOperations } from "./data/JenkinsPendingInputDataOperations";
import type { JenkinsQueueAndJobManagementOperations } from "./data/JenkinsQueueAndJobManagementOperations";

export type JenkinsArtifactRetrievalRuntimeSurface = Pick<
  JenkinsBuildDataOperations,
  "getArtifact" | "getArtifactStream"
>;

export type JenkinsBuildInspectionRuntimeSurface = Pick<
  JenkinsBuildDataOperations,
  | "getBuildDetails"
  | "getWorkflowRun"
  | "getConsoleText"
  | "getConsoleTextHead"
  | "getConsoleTextTail"
  | "getConsoleTextProgressive"
  | "getConsoleHtmlProgressive"
  | "getFlowNodeLog"
  | "getFlowNodeDetails"
  | "getFlowNodeLogHtmlProgressive"
  | "getTestReport"
>;

export type JenkinsCoverageRuntimeSurface = Pick<
  JenkinsCoverageDataOperations,
  "discoverCoverageActionPath" | "getCoverageOverview" | "getModifiedCoverageFiles"
>;

export type JenkinsPendingInputActionRuntimeSurface = Pick<
  JenkinsPendingInputDataOperations,
  "getPendingInputActions" | "approveInput" | "rejectInput"
>;

export type JenkinsPipelineRestartRuntimeSurface = Pick<
  JenkinsBuildDataOperations,
  "getRestartFromStageInfo" | "restartPipelineFromStage"
>;

export type JenkinsJobStateRuntimeSurface = Pick<
  JenkinsQueueAndJobManagementOperations,
  "enableJob" | "disableJob"
>;

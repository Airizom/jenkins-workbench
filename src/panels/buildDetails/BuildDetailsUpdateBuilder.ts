import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { PipelineRun } from "../../jenkins/pipeline/PipelineTypes";
import type { JenkinsBuildDetails, JenkinsTestReport } from "../../jenkins/types";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import {
  type BuildDetailsSectionsInput,
  assembleBuildDetailsSections
} from "./BuildDetailsViewModel";
import type { PipelineNodeLogViewModel } from "./shared/BuildDetailsContracts";
import type {
  BuildDetailsOutgoingMessage,
  BuildDetailsUpdateMessage
} from "./shared/BuildDetailsPanelMessages";

export interface BuildDetailsUpdateOptions {
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
}

function buildSectionsInput(
  details: JenkinsBuildDetails,
  testReport: JenkinsTestReport | undefined,
  options: BuildDetailsUpdateOptions | undefined,
  pipelineRun: PipelineRun | undefined,
  pendingInputs: PendingInputAction[] | undefined,
  pipelineLoading: boolean | undefined,
  pipelineRestartEnabled: boolean | undefined,
  pipelineRestartableStages: string[] | undefined,
  pipelineNodeLog: PipelineNodeLogViewModel | undefined
): BuildDetailsSectionsInput {
  return {
    details,
    testReport,
    testReportFetched: options?.testReportFetched,
    testReportLogsIncluded: options?.testReportLogsIncluded,
    testResultsLoading: options?.testResultsLoading,
    coverageOverview: options?.coverageOverview,
    modifiedCoverageFiles: options?.modifiedCoverageFiles,
    coverageActionPath: options?.coverageActionPath,
    coverageFetched: options?.coverageFetched,
    coverageLoading: options?.coverageLoading,
    coverageError: options?.coverageError,
    coverageEnabled: options?.coverageEnabled,
    pipelineRun,
    pipelineLoading,
    pipelineRestartEnabled,
    pipelineRestartableStages,
    pipelineNodeLog,
    pendingInputs,
    canOpenTestSource: options?.canOpenSource
  };
}

function buildSectionsInputFromPanelState(
  state: BuildDetailsPanelState,
  options?: Pick<BuildDetailsUpdateOptions, "canOpenSource" | "coverageEnabled">
): BuildDetailsSectionsInput {
  return {
    details: state.currentDetails,
    testReport: state.currentTestReport,
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
    pipelineRun: state.currentPipelineRun,
    pipelineLoading: state.pipelineLoading,
    pipelineRestartEnabled: state.pipelineRestartEnabled,
    pipelineRestartableStages: state.pipelineRestartableStages,
    pipelineNodeLog: state.pipelineNodeLog,
    pendingInputs: state.currentPendingInputs,
    canOpenTestSource: options?.canOpenSource
  };
}

export function buildDetailsUpdateMessage(
  details: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  options?: BuildDetailsUpdateOptions,
  pipelineRun?: PipelineRun,
  pendingInputs?: PendingInputAction[],
  pipelineLoading?: boolean,
  pipelineRestartEnabled?: boolean,
  pipelineRestartableStages?: string[],
  pipelineNodeLog?: PipelineNodeLogViewModel
): BuildDetailsUpdateMessage {
  return {
    type: "updateDetails",
    ...assembleBuildDetailsSections(
      buildSectionsInput(
        details,
        testReport,
        options,
        pipelineRun,
        pendingInputs,
        pipelineLoading,
        pipelineRestartEnabled,
        pipelineRestartableStages,
        pipelineNodeLog
      )
    )
  };
}

export function buildUpdateMessageFromState(
  state: BuildDetailsPanelState,
  options?: Pick<BuildDetailsUpdateOptions, "canOpenSource" | "coverageEnabled">
): BuildDetailsOutgoingMessage {
  return {
    type: "updateDetails",
    ...assembleBuildDetailsSections(buildSectionsInputFromPanelState(state, options))
  };
}

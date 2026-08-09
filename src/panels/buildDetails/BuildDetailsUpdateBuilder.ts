import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import {
  assembleBuildDetailsSections,
  type BuildDetailsSectionsInput
} from "./BuildDetailsViewModel";
import type { BuildDetailsOutgoingMessage } from "./shared/BuildDetailsPanelMessages";

export interface BuildDetailsUpdateOptions {
  coverageEnabled?: boolean;
  canOpenSource?: (className?: string) => boolean;
}

function buildSectionsInputFromPanelState(
  state: BuildDetailsPanelState,
  options?: BuildDetailsUpdateOptions
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

export function buildUpdateMessageFromState(
  state: BuildDetailsPanelState,
  options?: BuildDetailsUpdateOptions
): BuildDetailsOutgoingMessage {
  return {
    type: "updateDetails",
    ...assembleBuildDetailsSections(buildSectionsInputFromPanelState(state, options))
  };
}

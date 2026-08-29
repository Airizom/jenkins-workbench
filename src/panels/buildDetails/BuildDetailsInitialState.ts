import { toPipelineRun } from "../../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { getBuildDetailsCoverageEnabled, MAX_CONSOLE_CHARS } from "./BuildDetailsConfig";
import { formatError } from "./BuildDetailsFormatters";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import type { BuildDetailsInitialState } from "./BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import { buildBuildDetailsViewModel } from "./BuildDetailsViewModel";

export function applyBuildDetailsInitialState(
  state: BuildDetailsPanelState,
  initialState: BuildDetailsInitialState
): void {
  state.applyInitialState(
    initialState,
    toPipelineRun(initialState.workflowRun),
    formatInitialPipelineError(initialState.workflowError)
  );
}

export function buildInitialBuildDetailsViewModel(
  state: BuildDetailsPanelState,
  initialState: BuildDetailsInitialState,
  canOpenTestSource: BuildDetailsCanOpenTestSource | undefined
) {
  return buildBuildDetailsViewModel({
    details: state.currentDetails,
    buildUrl: state.currentBuildUrl,
    pipelineRun: state.currentPipelineRun,
    pipelineLoading: state.pipelineLoading,
    consoleTextResult: initialState.consoleTextResult,
    consoleHtmlResult: initialState.consoleHtmlResult,
    errors: state.currentErrors,
    maxConsoleChars: MAX_CONSOLE_CHARS,
    followLog: state.followLog,
    pendingInputs: state.currentPendingInputs,
    pipelineRestartEnabled: state.pipelineRestartEnabled,
    pipelineRestartableStages: state.pipelineRestartableStages,
    pipelineNodeLog: state.pipelineNodeLog,
    testReportFetched: state.testReportFetched,
    testReportLogsIncluded: state.testReportLogsIncluded,
    testResultsLoading: state.testResultsLoading,
    coverageOverview: state.currentCoverageOverview,
    modifiedCoverageFiles: state.currentModifiedCoverageFiles,
    coverageActionPath: state.currentCoverageActionPath,
    coverageFetched: state.coverageFetched,
    coverageLoading: state.coverageLoading,
    coverageError: state.currentCoverageError,
    coverageEnabled: getBuildDetailsCoverageEnabled(),
    canOpenTestSource: (className) =>
      canOpenTestSource?.(state.environment, state.currentBuildUrl, className) ?? false
  });
}

export function resolveInitialPanelTitle(
  details: JenkinsBuildDetails | undefined,
  fallback: string | undefined
): string | undefined {
  return details?.fullDisplayName ?? details?.displayName ?? fallback;
}

function formatInitialPipelineError(error: unknown): string | undefined {
  return error ? `Pipeline stages: ${formatError(error)}` : undefined;
}

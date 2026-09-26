import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import { isPlainRecord } from "../../../shared/runtimeGuards";
import type { SerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import {
  createEnvironmentScopedPanelState,
  isNonEmptyString,
  validateEnvironmentScopedPanelState
} from "../../shared/webview/WebviewPanelState";
import {
  isPipelineLogTargetViewModel,
  normalizePipelineLogTarget,
  type PipelineLogTargetViewModel
} from "./BuildDetailsContracts";

export const PIPELINE_PRESENTATIONS = ["graph", "list"] as const;
export type PipelinePresentation = (typeof PIPELINE_PRESENTATIONS)[number];

export const BUILD_DETAILS_TABS = ["overview", "inputs", "pipeline", "console", "tests"] as const;
export type BuildDetailsTab = (typeof BUILD_DETAILS_TABS)[number];

export interface BuildDetailsPanelUiState {
  selectedTab?: BuildDetailsTab;
  pipelinePresentation?: PipelinePresentation;
  selectedGraphStageKey?: string;
  selectedPipelineLogTarget?: PipelineLogTargetViewModel;
}

export interface BuildDetailsPanelSerializedState extends SerializedEnvironmentState {
  buildUrl: string;
  /**
   * Best-effort UI state restored from an earlier session, possibly written by
   * an older version. Read it through normalizeBuildDetailsPanelUiState.
   */
  buildDetailsUi?: unknown;
}

function createBuildDetailsPanelState(
  environment: JenkinsEnvironmentRef,
  buildUrl: string,
  uiState?: BuildDetailsPanelUiState
): BuildDetailsPanelSerializedState {
  return createEnvironmentScopedPanelState(environment, {
    buildUrl,
    buildDetailsUi: normalizeBuildDetailsPanelUiState(uiState)
  });
}

export function isBuildDetailsPanelState(
  value: unknown
): value is BuildDetailsPanelSerializedState {
  return validateEnvironmentScopedPanelState(value, (record) => {
    if (!isNonEmptyString(record.buildUrl)) {
      return false;
    }

    return typeof record.buildDetailsUi === "undefined" || isPlainRecord(record.buildDetailsUi);
  });
}

export function normalizeBuildDetailsPanelUiState(
  value: unknown
): BuildDetailsPanelUiState | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const selectedTab = isBuildDetailsTab(value.selectedTab) ? value.selectedTab : undefined;
  const pipelinePresentation = isPipelinePresentation(value.pipelinePresentation)
    ? value.pipelinePresentation
    : undefined;
  const selectedGraphStageKey =
    typeof value.selectedGraphStageKey === "string" && value.selectedGraphStageKey.trim().length > 0
      ? value.selectedGraphStageKey.trim()
      : undefined;
  const selectedPipelineLogTarget = normalizePipelineLogTarget(value.selectedPipelineLogTarget);

  if (
    !selectedTab &&
    !pipelinePresentation &&
    !selectedGraphStageKey &&
    !selectedPipelineLogTarget
  ) {
    return undefined;
  }

  return {
    selectedTab,
    pipelinePresentation,
    selectedGraphStageKey,
    selectedPipelineLogTarget
  };
}

export function withBuildDetailsPanelUiState(
  state: BuildDetailsPanelSerializedState,
  uiState: BuildDetailsPanelUiState
): BuildDetailsPanelSerializedState {
  return {
    ...state,
    buildDetailsUi: normalizeBuildDetailsPanelUiState({
      ...normalizeBuildDetailsPanelUiState(state.buildDetailsUi),
      ...uiState
    })
  };
}

export function mergeBuildDetailsPanelState(
  previousState: BuildDetailsPanelSerializedState | undefined,
  environment: JenkinsEnvironmentRef,
  buildUrl: string
): BuildDetailsPanelSerializedState {
  const samePanelTarget =
    previousState?.buildUrl === buildUrl &&
    previousState.environmentId === environment.environmentId &&
    previousState.scope === environment.scope;
  const previousUi = normalizeBuildDetailsPanelUiState(previousState?.buildDetailsUi);
  const previousUiState = samePanelTarget
    ? previousUi
    : previousUi?.pipelinePresentation
      ? { pipelinePresentation: previousUi.pipelinePresentation }
      : undefined;
  return createBuildDetailsPanelState(environment, buildUrl, previousUiState);
}

export function isBuildDetailsPanelUiState(value: unknown): value is BuildDetailsPanelUiState {
  return (
    isPlainRecord(value) &&
    (typeof value.selectedTab === "undefined" || isBuildDetailsTab(value.selectedTab)) &&
    (typeof value.pipelinePresentation === "undefined" ||
      isPipelinePresentation(value.pipelinePresentation)) &&
    (typeof value.selectedGraphStageKey === "undefined" ||
      typeof value.selectedGraphStageKey === "string") &&
    (typeof value.selectedPipelineLogTarget === "undefined" ||
      isPipelineLogTargetViewModel(value.selectedPipelineLogTarget))
  );
}

export function isPipelinePresentation(value: unknown): value is PipelinePresentation {
  return PIPELINE_PRESENTATIONS.some((presentation) => presentation === value);
}

function isBuildDetailsTab(value: unknown): value is BuildDetailsTab {
  return BUILD_DETAILS_TABS.some((tab) => tab === value);
}

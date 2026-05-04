import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type { SerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import { isSerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import {
  type PipelineLogTargetViewModel,
  normalizePipelineLogTarget
} from "./BuildDetailsContracts";

export type PipelinePresentation = "graph" | "list";

export interface BuildDetailsPanelUiState {
  pipelinePresentation?: PipelinePresentation;
  selectedGraphStageKey?: string;
  selectedPipelineLogTarget?: PipelineLogTargetViewModel;
}

export interface BuildDetailsPanelSerializedState extends SerializedEnvironmentState {
  buildUrl: string;
  buildDetailsUi?: BuildDetailsPanelUiState;
}

export function createBuildDetailsPanelState(
  environment: JenkinsEnvironmentRef,
  buildUrl: string,
  uiState?: BuildDetailsPanelUiState
): BuildDetailsPanelSerializedState {
  return {
    environmentId: environment.environmentId,
    scope: environment.scope,
    buildUrl,
    buildDetailsUi: normalizeBuildDetailsPanelUiState(uiState)
  };
}

export function isBuildDetailsPanelState(
  value: unknown
): value is BuildDetailsPanelSerializedState {
  if (!isSerializedEnvironmentState(value)) {
    return false;
  }

  const record = value as unknown as Record<string, unknown>;
  if (typeof record.buildUrl !== "string" || record.buildUrl.length === 0) {
    return false;
  }

  return (
    typeof record.buildDetailsUi === "undefined" ||
    isBuildDetailsPanelUiState(record.buildDetailsUi)
  );
}

export function normalizeBuildDetailsPanelUiState(
  value: unknown
): BuildDetailsPanelUiState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const pipelinePresentation = isPipelinePresentation(record.pipelinePresentation)
    ? record.pipelinePresentation
    : undefined;
  const selectedGraphStageKey =
    typeof record.selectedGraphStageKey === "string" &&
    record.selectedGraphStageKey.trim().length > 0
      ? record.selectedGraphStageKey.trim()
      : undefined;
  const selectedPipelineLogTarget = normalizePipelineLogTarget(record.selectedPipelineLogTarget);

  if (!pipelinePresentation && !selectedGraphStageKey && !selectedPipelineLogTarget) {
    return undefined;
  }

  return {
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
      ...(state.buildDetailsUi ?? {}),
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
  const previousUiState = samePanelTarget
    ? previousState.buildDetailsUi
    : previousState?.buildDetailsUi?.pipelinePresentation
      ? { pipelinePresentation: previousState.buildDetailsUi.pipelinePresentation }
      : undefined;
  return createBuildDetailsPanelState(environment, buildUrl, previousUiState);
}

function isBuildDetailsPanelUiState(value: unknown): value is BuildDetailsPanelUiState {
  return normalizeBuildDetailsPanelUiState(value) !== undefined || isEmptyObject(value);
}

function isPipelinePresentation(value: unknown): value is PipelinePresentation {
  return value === "graph" || value === "list";
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.keys(value).length === 0;
}

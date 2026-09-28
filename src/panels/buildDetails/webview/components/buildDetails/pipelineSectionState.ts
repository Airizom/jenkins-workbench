import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import type {
  BuildDetailsPanelUiState,
  PipelinePresentation
} from "../../../shared/BuildDetailsPanelWebviewState";
import { findPipelineLogTargetStatus } from "./pipelineLogTargets";
import { findDefaultPipelineStage, isPipelinePresentation } from "./pipelineSectionModel";

const DEFAULT_PRESENTATION: PipelinePresentation = "list";

export type PersistedPipelineUiState = Pick<
  BuildDetailsPanelUiState,
  "pipelinePresentation" | "selectedGraphStageKey" | "selectedPipelineLogTarget"
>;

export interface InitialPipelineSectionState {
  presentation: PipelinePresentation;
  selectedStageKey?: string;
  restoredLogTarget?: PipelineLogTargetViewModel;
}

export function normalizeInitialPipelineState(
  persisted: PersistedPipelineUiState
): InitialPipelineSectionState {
  return {
    presentation: isPipelinePresentation(persisted.pipelinePresentation)
      ? persisted.pipelinePresentation
      : DEFAULT_PRESENTATION,
    selectedStageKey: normalizeInitialStageKey(persisted.selectedGraphStageKey),
    restoredLogTarget: persisted.selectedPipelineLogTarget
  };
}

function normalizeInitialStageKey(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function isSamePersistedPipelineUiState(
  previous: PersistedPipelineUiState | undefined,
  next: PersistedPipelineUiState
): boolean {
  if (!previous) {
    return false;
  }
  return (
    previous.pipelinePresentation === next.pipelinePresentation &&
    previous.selectedGraphStageKey === next.selectedGraphStageKey &&
    isSamePersistedLogTarget(previous.selectedPipelineLogTarget, next.selectedPipelineLogTarget)
  );
}

// Compares exactly the fields that survive normalizePipelineLogTarget, so an
// unchanged payload is only skipped when it would persist identically.
const PERSISTED_LOG_TARGET_FIELDS = ["key", "kind", "name", "nodeId"] as const;

function isSamePersistedLogTarget(
  a: PipelineLogTargetViewModel | undefined,
  b: PipelineLogTargetViewModel | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    PERSISTED_LOG_TARGET_FIELDS.every((field) => a[field] === b[field]) &&
    isSameChildNodeIds(a.childNodeIds, b.childNodeIds)
  );
}

function isSameChildNodeIds(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export interface DefaultStageSelectionGate {
  done: boolean;
  isActive: boolean;
  canValidateLogTarget: boolean;
  stageCount: number;
  hasRestoredTarget: boolean;
  restoreConsumed: boolean;
}

/**
 * The default stage is picked once, the first time the tab is shown with
 * validated stages and no persisted log selection still waiting to restore.
 */
export function isDefaultStageSelectionDue(gate: DefaultStageSelectionGate): boolean {
  return (
    !gate.done &&
    gate.isActive &&
    gate.canValidateLogTarget &&
    gate.stageCount > 0 &&
    !(gate.hasRestoredTarget && !gate.restoreConsumed)
  );
}

/** Any existing or restored selection wins over the default stage. */
export function pickDefaultStageToOpen({
  stages,
  isRunning,
  hasCurrentTarget,
  restoredLogSelected
}: {
  stages: PipelineStageViewModel[];
  isRunning: boolean;
  hasCurrentTarget: boolean;
  restoredLogSelected: boolean;
}): PipelineStageViewModel | undefined {
  if (hasCurrentTarget || restoredLogSelected) {
    return undefined;
  }
  return findDefaultPipelineStage(stages, isRunning);
}

export function canFollowPipelineNodeLog(
  stages: PipelineStageViewModel[],
  log: PipelineNodeLogViewModel,
  isRunning: boolean
): boolean {
  const nodeLogStatus = findPipelineLogTargetStatus(stages, log.target);
  return isRunning && (log.polling === true || nodeLogStatus === "running");
}

import * as React from "react";
import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import type { PipelinePresentation } from "../../../shared/BuildDetailsPanelWebviewState";
import {
  getBuildDetailsPanelUiState,
  setBuildDetailsPanelUiState
} from "../../lib/buildDetailsPanelState";
import {
  derivePipelineSectionView,
  findStageLogTarget,
  isPipelinePresentation,
  planRestoredLogTarget,
  resolvePersistedPipelineLogTarget
} from "./pipelineSectionModel";
import {
  isDefaultStageSelectionDue,
  isSamePersistedPipelineUiState,
  normalizeInitialPipelineState,
  type PersistedPipelineUiState,
  pickDefaultStageToOpen
} from "./pipelineSectionState";

const { useCallback, useEffect, useRef, useState } = React;

const GRAPH_FALLBACK_NOTICE =
  "Graph layout failed for the current pipeline. Showing list view instead.";

type SelectPipelineLog = (target: PipelineLogTargetViewModel) => void;

interface PipelineLogContext {
  restoredLogTarget?: PipelineLogTargetViewModel;
  canValidateLogTarget: boolean;
  currentTarget?: PipelineLogTargetViewModel;
  stages: PipelineStageViewModel[];
}

function readInitialPipelineState() {
  return normalizeInitialPipelineState(getBuildDetailsPanelUiState());
}

function usePersistPipelineUiState({
  restoredLogTarget,
  canValidateLogTarget,
  currentTarget,
  stages,
  presentation,
  selectedStageKey
}: PipelineLogContext & {
  presentation: PipelinePresentation;
  selectedStageKey?: string;
}): void {
  const lastPersistedUiStateRef = useRef<PersistedPipelineUiState | undefined>(undefined);

  useEffect(() => {
    const nextUiState: PersistedPipelineUiState = {
      pipelinePresentation: presentation,
      selectedGraphStageKey: selectedStageKey,
      selectedPipelineLogTarget: resolvePersistedPipelineLogTarget({
        currentTarget,
        restoredTarget: restoredLogTarget,
        canValidateLogTarget,
        stages
      })
    };
    // Polling replaces stages/target identities on every update; skip the
    // vscode setState + host postMessage when the payload is unchanged.
    if (isSamePersistedPipelineUiState(lastPersistedUiStateRef.current, nextUiState)) {
      return;
    }
    lastPersistedUiStateRef.current = nextUiState;
    setBuildDetailsPanelUiState(nextUiState);
  }, [
    canValidateLogTarget,
    presentation,
    restoredLogTarget,
    selectedStageKey,
    stages,
    currentTarget
  ]);
}

interface RestoredLogSelection {
  consumedRef: React.RefObject<boolean>;
  selectedRef: React.RefObject<boolean>;
}

function useRestoredPipelineLogSelection({
  restoredLogTarget,
  canValidateLogTarget,
  currentTarget,
  stages,
  onSelectPipelineLog
}: PipelineLogContext & { onSelectPipelineLog: SelectPipelineLog }): RestoredLogSelection {
  const consumedRef = useRef(false);
  const selectedRef = useRef(false);

  useEffect(() => {
    // Restore the persisted log selection at most once; marking it consumed
    // before firing keeps a later user close (target -> undefined) from
    // reopening the pane and avoids reposting the selection on every render.
    const plan = planRestoredLogTarget({
      alreadyConsumed: consumedRef.current,
      restoredTarget: restoredLogTarget,
      canValidateLogTarget,
      currentTarget,
      stages
    });
    if (!plan.consume) {
      return;
    }
    consumedRef.current = true;
    if (plan.targetToRestore) {
      selectedRef.current = true;
      onSelectPipelineLog(plan.targetToRestore);
    }
  }, [canValidateLogTarget, currentTarget, restoredLogTarget, stages, onSelectPipelineLog]);

  return { consumedRef, selectedRef };
}

function useDefaultPipelineStageSelection(
  { restoredLogTarget, canValidateLogTarget, currentTarget, stages }: PipelineLogContext,
  { consumedRef, selectedRef }: RestoredLogSelection,
  { isActive, isRunning }: { isActive: boolean; isRunning: boolean },
  { doneRef, openStage }: Pick<PipelineStageSelection, "doneRef" | "openStage">
): void {
  useEffect(() => {
    // The first time the tab is shown with nothing selected, open the stage
    // that explains the run: the running stage, else the first failure. Any
    // existing or restored selection wins, and this never runs twice.
    const due = isDefaultStageSelectionDue({
      done: doneRef.current,
      isActive,
      canValidateLogTarget,
      stageCount: stages.length,
      hasRestoredTarget: Boolean(restoredLogTarget),
      restoreConsumed: consumedRef.current
    });
    if (!due) {
      return;
    }
    doneRef.current = true;
    const stage = pickDefaultStageToOpen({
      stages,
      isRunning,
      hasCurrentTarget: Boolean(currentTarget),
      restoredLogSelected: selectedRef.current
    });
    if (stage) {
      openStage(stage);
    }
  }, [
    isActive,
    isRunning,
    canValidateLogTarget,
    stages,
    restoredLogTarget,
    currentTarget,
    consumedRef,
    selectedRef,
    doneRef,
    openStage
  ]);
}

function usePipelinePresentation(initialPresentation: PipelinePresentation) {
  const [presentation, setPresentation] = useState<PipelinePresentation>(initialPresentation);
  const [fallbackNotice, setFallbackNotice] = useState<string | undefined>();

  const changePresentation = (value: string) => {
    if (isPipelinePresentation(value)) {
      setFallbackNotice(undefined);
      setPresentation(value);
    }
  };
  const fallBackToList = () => {
    setFallbackNotice(GRAPH_FALLBACK_NOTICE);
    setPresentation("list");
  };

  return { presentation, fallbackNotice, changePresentation, fallBackToList };
}

function usePipelineStageSelection(
  initialStageKey: string | undefined,
  stages: PipelineStageViewModel[],
  onSelectPipelineLog: SelectPipelineLog
) {
  // Set once the default stage was opened or the user picked something, so the
  // default selection never overrides (or repeats after) an explicit choice.
  const doneRef = useRef(false);
  const [selectedStageKey, setSelectedStageKey] = useState(initialStageKey);
  const [expandedStageKey, setExpandedStageKey] = useState<string | undefined>();
  const openStage = useCallback(
    (stage: PipelineStageViewModel) => {
      setSelectedStageKey(stage.key);
      setExpandedStageKey(stage.key);
      if (stage.logTarget) {
        onSelectPipelineLog(stage.logTarget);
      }
    },
    [onSelectPipelineLog]
  );

  return {
    doneRef,
    openStage,
    selectedStageKey,
    expandedStageKey,
    selectGraphStage: (stageKey: string | undefined) => {
      doneRef.current = true;
      setSelectedStageKey(stageKey);
      const target = findStageLogTarget(stages, stageKey);
      if (target) {
        onSelectPipelineLog(target);
      }
    },
    // Keeps the graph selection valid as the layout changes. Unlike a user
    // selection it must not request a log: it runs after every graph render.
    syncGraphStage: setSelectedStageKey,
    markUserSelection: () => {
      doneRef.current = true;
    }
  };
}

type PipelineStageSelection = ReturnType<typeof usePipelineStageSelection>;

/**
 * Owns the pipeline presentation and stage/log selection, including the
 * one-time restore of the persisted log target and the default stage pick.
 */
export function usePipelineSectionState({
  stages,
  currentTarget,
  loading,
  isActive,
  isRunning,
  onSelectPipelineLog
}: {
  stages: PipelineStageViewModel[];
  currentTarget?: PipelineLogTargetViewModel;
  loading: boolean;
  isActive: boolean;
  isRunning: boolean;
  onSelectPipelineLog: SelectPipelineLog;
}) {
  // Single vscode-state read per mount, validated and normalized once.
  const [initial] = useState(readInitialPipelineState);
  const presentationState = usePipelinePresentation(initial.presentation);
  const { doneRef, openStage, ...selection } = usePipelineStageSelection(
    initial.selectedStageKey,
    stages,
    onSelectPipelineLog
  );
  const view = derivePipelineSectionView(loading, stages.length, presentationState.presentation);
  const logContext: PipelineLogContext = {
    restoredLogTarget: initial.restoredLogTarget,
    canValidateLogTarget: view.canValidateLogTarget,
    currentTarget,
    stages
  };

  usePersistPipelineUiState({
    ...logContext,
    presentation: presentationState.presentation,
    selectedStageKey: selection.selectedStageKey
  });
  const restored = useRestoredPipelineLogSelection({ ...logContext, onSelectPipelineLog });
  useDefaultPipelineStageSelection(
    logContext,
    restored,
    { isActive, isRunning },
    { doneRef, openStage }
  );

  return { ...presentationState, ...selection, view };
}

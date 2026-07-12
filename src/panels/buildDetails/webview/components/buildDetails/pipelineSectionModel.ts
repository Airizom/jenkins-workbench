import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import type { PipelinePresentation } from "../../../shared/BuildDetailsPanelWebviewState";
import { hasPipelineLogTarget } from "./pipelineLogTargets";

export type PipelineSectionBodyKind = "placeholder" | "graph" | "list";

export interface PipelineSectionView {
  hidden: boolean;
  hasStages: boolean;
  canValidateLogTarget: boolean;
  showLoadingBanner: boolean;
  body: PipelineSectionBodyKind;
}

export function derivePipelineSectionView(
  loading: boolean,
  stageCount: number,
  presentation: PipelinePresentation
): PipelineSectionView {
  const hasStages = stageCount > 0;
  const showPlaceholder = loading && !hasStages;
  return {
    hidden: !loading && !hasStages,
    hasStages,
    canValidateLogTarget: hasStages || !loading,
    showLoadingBanner: loading && hasStages,
    body: showPlaceholder ? "placeholder" : presentation === "graph" ? "graph" : "list"
  };
}

export function isPipelinePresentation(value: unknown): value is PipelinePresentation {
  return value === "graph" || value === "list";
}

export function resolvePersistedPipelineLogTarget({
  currentTarget,
  restoredTarget,
  canValidateLogTarget,
  stages
}: {
  currentTarget: PipelineLogTargetViewModel | undefined;
  restoredTarget: PipelineLogTargetViewModel | undefined;
  canValidateLogTarget: boolean;
  stages: PipelineStageViewModel[];
}): PipelineLogTargetViewModel | undefined {
  if (currentTarget && (!canValidateLogTarget || hasPipelineLogTarget(stages, currentTarget))) {
    return currentTarget;
  }
  return canValidateLogTarget ? undefined : restoredTarget;
}

export interface RestoredLogTargetPlan {
  consume: boolean;
  targetToRestore?: PipelineLogTargetViewModel;
}

export function planRestoredLogTarget({
  alreadyConsumed,
  restoredTarget,
  canValidateLogTarget,
  currentTarget,
  stages
}: {
  alreadyConsumed: boolean;
  restoredTarget: PipelineLogTargetViewModel | undefined;
  canValidateLogTarget: boolean;
  currentTarget: PipelineLogTargetViewModel | undefined;
  stages: PipelineStageViewModel[];
}): RestoredLogTargetPlan {
  if (alreadyConsumed || !restoredTarget || !canValidateLogTarget) {
    return { consume: false };
  }
  const shouldRestore = !currentTarget && hasPipelineLogTarget(stages, restoredTarget);
  return { consume: true, targetToRestore: shouldRestore ? restoredTarget : undefined };
}

export function findStageByKey(
  stages: PipelineStageViewModel[],
  key: string
): PipelineStageViewModel | undefined {
  for (const stage of stages) {
    if (stage.key === key) {
      return stage;
    }
    const branch = findStageByKey(stage.parallelBranches, key);
    if (branch) {
      return branch;
    }
  }
  return undefined;
}

export function findStageLogTarget(
  stages: PipelineStageViewModel[],
  stageKey: string | undefined
): PipelineLogTargetViewModel | undefined {
  const stage = stageKey ? findStageByKey(stages, stageKey) : undefined;
  return stage?.logTarget;
}

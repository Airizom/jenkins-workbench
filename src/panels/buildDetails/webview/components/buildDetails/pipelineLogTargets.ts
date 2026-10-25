import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";

export function hasPipelineLogTarget(
  stages: PipelineStageViewModel[],
  target: PipelineLogTargetViewModel
): boolean {
  return findPipelineLogTargetOwner(stages, target) !== undefined;
}

/** Status class of the stage, branch, or step that owns `target`, if any. */
export function findPipelineLogTargetStatus(
  stages: PipelineStageViewModel[],
  target: PipelineLogTargetViewModel | undefined
): string | undefined {
  return target ? findPipelineLogTargetOwner(stages, target)?.statusClass : undefined;
}

// stepsFailedOnly is a subset of stepsAll, so only stepsAll is scanned.
function findPipelineLogTargetOwner(
  stages: PipelineStageViewModel[],
  target: PipelineLogTargetViewModel
): PipelineStageViewModel | PipelineStageStepViewModel | undefined {
  for (const stage of stages) {
    if (isSamePipelineLogTarget(stage.logTarget, target)) {
      return stage;
    }
    const step = stage.stepsAll.find((candidate) =>
      isSamePipelineLogTarget(candidate.logTarget, target)
    );
    if (step) {
      return step;
    }
    const branchOwner = findPipelineLogTargetOwner(stage.parallelBranches, target);
    if (branchOwner) {
      return branchOwner;
    }
  }
  return undefined;
}

function isSamePipelineLogTarget(
  candidate: PipelineLogTargetViewModel | undefined,
  target: PipelineLogTargetViewModel
): boolean {
  return candidate?.key === target.key && candidate.kind === target.kind;
}

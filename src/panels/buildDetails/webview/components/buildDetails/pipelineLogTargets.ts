import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";

export function hasPipelineLogTarget(
  stages: PipelineStageViewModel[],
  target: PipelineLogTargetViewModel
): boolean {
  for (const stage of stages) {
    if (isSamePipelineLogTarget(stage.logTarget, target)) {
      return true;
    }
    if (
      hasStepLogTarget(stage.stepsAll, target) ||
      hasStepLogTarget(stage.stepsFailedOnly, target)
    ) {
      return true;
    }
    if (hasPipelineLogTarget(stage.parallelBranches, target)) {
      return true;
    }
  }
  return false;
}

function hasStepLogTarget(
  steps: PipelineStageStepViewModel[],
  target: PipelineLogTargetViewModel
): boolean {
  return steps.some((step) => isSamePipelineLogTarget(step.logTarget, target));
}

function isSamePipelineLogTarget(
  candidate: PipelineLogTargetViewModel | undefined,
  target: PipelineLogTargetViewModel
): boolean {
  return candidate?.key === target.key && candidate.kind === target.kind;
}

import type {
  PipelineRun,
  PipelineStage,
  PipelineStep
} from "../../jenkins/pipeline/PipelineTypes";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { formatDuration, normalizePipelineStatus } from "./BuildDetailsFormatters";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";
import type {
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "./shared/BuildDetailsContracts";

export interface PipelineStageRestartContext {
  details?: JenkinsBuildDetails;
  restartEnabled: boolean;
  restartableStages: string[];
}

interface PipelineStageRestartState {
  enabled: boolean;
  restartableStages: Set<string>;
}

export function buildPipelineStagesViewModel(
  pipelineRun?: PipelineRun,
  restartContext?: PipelineStageRestartContext
): PipelineStageViewModel[] {
  const stages = pipelineRun?.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    return [];
  }
  const restartState = createPipelineStageRestartState(restartContext);
  return stages.map((stage) => mapPipelineStage(stage, restartState));
}

interface PipelineStepDraft extends PipelineStageStepViewModel {
  isFailed: boolean;
}

function mapPipelineStage(
  stage: PipelineStage,
  restartState: PipelineStageRestartState
): PipelineStageViewModel {
  const key = stage.key;
  const status = normalizePipelineStatus(stage.status);
  const durationMs = normalizeDurationMillis(stage.durationMillis);
  const durationLabel = formatDuration(stage.durationMillis);
  const steps = stage.steps.map((step) => mapPipelineStep(step));
  const stepsFailedOnly = steps.filter((step) => step.isFailed);
  const stepsAll = steps.map((step) => stripFailure(step));
  const parallelBranches = mapParallelBranches(stage, restartState);
  const hasSteps = stepsAll.length > 0 || parallelBranches.some((branch) => branch.hasSteps);
  const stageName = stage.name.trim();
  const canRestartFromStage =
    restartState.enabled && stageName.length > 0 && restartState.restartableStages.has(stageName);

  return {
    key,
    name: stage.name,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel,
    durationMs,
    canRestartFromStage,
    hasSteps,
    stepsFailedOnly: stepsFailedOnly.map((step) => stripFailure(step)),
    stepsAll,
    parallelBranches
  };
}

function mapParallelBranches(
  stage: PipelineStage,
  restartState: PipelineStageRestartState
): PipelineStageViewModel[] {
  const branches = stage.parallelBranches;
  if (branches.length === 0) {
    return [];
  }
  return branches.map((branch) => mapPipelineStage(branch, restartState));
}

function createPipelineStageRestartState(
  context: PipelineStageRestartContext | undefined
): PipelineStageRestartState {
  if (!context || !isPipelineRestartEligible(context.details) || !context.restartEnabled) {
    return { enabled: false, restartableStages: new Set<string>() };
  }
  const restartableStages = new Set<string>();
  for (const stage of context.restartableStages) {
    const trimmed = stage.trim();
    if (trimmed.length === 0) {
      continue;
    }
    restartableStages.add(trimmed);
  }
  return { enabled: restartableStages.size > 0, restartableStages };
}

function mapPipelineStep(step: PipelineStep): PipelineStepDraft {
  const status = normalizePipelineStatus(step.status);
  const durationLabel = formatDuration(step.durationMillis);
  return {
    name: step.name,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel,
    isFailed: status.isFailed
  };
}

function stripFailure(step: PipelineStepDraft): PipelineStageStepViewModel {
  return {
    name: step.name,
    statusLabel: step.statusLabel,
    statusClass: step.statusClass,
    durationLabel: step.durationLabel
  };
}

function normalizeDurationMillis(duration?: number): number | undefined {
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return undefined;
  }
  return Math.max(0, Math.floor(duration));
}

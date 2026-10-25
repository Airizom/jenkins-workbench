import { normalizePipelineStatus } from "../../formatters/BuildStatusFormatters";
import type {
  PipelineRun,
  PipelineStage,
  PipelineStep
} from "../../jenkins/pipeline/PipelineTypes";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { formatBuildDuration } from "../../shared/build/BuildHeaderLabels";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";
import type {
  PipelineLogTargetViewModel,
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

function mapPipelineStage(
  stage: PipelineStage,
  restartState: PipelineStageRestartState
): PipelineStageViewModel {
  const key = stage.key;
  const status = normalizePipelineStatus(stage.status);
  const durationMs = normalizeDurationMillis(stage.durationMillis);
  const durationLabel = formatBuildDuration(stage.durationMillis);
  const stepsAll: PipelineStageStepViewModel[] = [];
  const stepsFailedOnly: PipelineStageStepViewModel[] = [];
  for (const step of stage.steps) {
    const { viewModel, isFailed } = mapPipelineStep(step);
    stepsAll.push(viewModel);
    if (isFailed) {
      stepsFailedOnly.push(viewModel);
    }
  }
  const parallelBranches = mapParallelBranches(stage, restartState);
  const hasSteps = stepsAll.length > 0 || parallelBranches.some((branch) => branch.hasSteps);
  const logTarget = buildStageLogTarget(stage);
  const canRestartFromStage =
    restartState.enabled && restartState.restartableStages.has(stage.name);

  return {
    key,
    nodeId: stage.nodeId,
    logTarget,
    name: stage.name,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel,
    durationMs,
    canRestartFromStage,
    hasSteps,
    stepsFailedOnly,
    stepsAll,
    parallelBranches,
    canOpenLog: Boolean(logTarget)
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
  // BuildDetailsPanelState.setPipelineRestartInfo already drops blank and duplicate names.
  const restartableStages = new Set(context.restartableStages);
  return { enabled: restartableStages.size > 0, restartableStages };
}

function mapPipelineStep(step: PipelineStep): {
  viewModel: PipelineStageStepViewModel;
  isFailed: boolean;
} {
  const status = normalizePipelineStatus(step.status);
  const durationLabel = formatBuildDuration(step.durationMillis);
  return {
    viewModel: {
      key: step.key,
      nodeId: step.nodeId,
      logTarget: buildStepLogTarget(step),
      name: step.name,
      statusLabel: status.label,
      statusClass: status.className,
      durationLabel,
      canOpenLog: Boolean(step.nodeId)
    },
    isFailed: status.isFailed
  };
}

function collectStageChildNodeIds(stage: PipelineStage): string[] {
  const ids: string[] = [];
  for (const step of stage.steps) {
    if (step.nodeId) {
      ids.push(step.nodeId);
    }
  }
  for (const branch of stage.parallelBranches) {
    if (branch.nodeId) {
      ids.push(branch.nodeId);
    }
    ids.push(...collectStageChildNodeIds(branch));
  }
  return ids;
}

function buildStageLogTarget(stage: PipelineStage): PipelineLogTargetViewModel | undefined {
  const childNodeIds = collectStageChildNodeIds(stage);
  if (!stage.nodeId && childNodeIds.length === 0) {
    return undefined;
  }
  return {
    key: stage.key,
    kind: "stage",
    name: stage.name || "Stage",
    nodeId: stage.nodeId,
    childNodeIds
  };
}

function buildStepLogTarget(step: PipelineStep): PipelineLogTargetViewModel | undefined {
  if (!step.nodeId) {
    return undefined;
  }
  return {
    key: step.key,
    kind: "step",
    name: step.name || "Step",
    nodeId: step.nodeId
  };
}

function normalizeDurationMillis(duration?: number): number | undefined {
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return undefined;
  }
  return Math.max(0, Math.floor(duration));
}

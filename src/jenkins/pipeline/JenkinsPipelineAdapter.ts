import type { JenkinsWorkflowRun, JenkinsWorkflowStage, JenkinsWorkflowStep } from "../types";
import type { PipelineRun, PipelineStage, PipelineStep } from "./PipelineTypes";

export type { PipelineRun, PipelineStage, PipelineStep } from "./PipelineTypes";

export function toPipelineRun(workflowRun?: JenkinsWorkflowRun): PipelineRun | undefined {
  const stages = workflowRun?.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    return undefined;
  }
  return {
    status: workflowRun?.status,
    stages: stages.map((stage, index) => mapStage(stage, index))
  };
}

function mapStage(stage: JenkinsWorkflowStage, index: number, parentKey?: string): PipelineStage {
  const key = buildStageKey(stage.id ?? stage.name ?? "stage", index, parentKey);
  const steps = getStageSteps(stage);
  const branches = getStageBranches(stage);
  return {
    key,
    name: stage.name ?? "Stage",
    status: stage.status,
    durationMillis: pickNumber(stage.durationMillis, stage.execDurationMillis),
    steps: steps.map((step, stepIndex) => mapStep(step, stepIndex, key)),
    parallelBranches: branches.map((branch, branchIndex) => mapStage(branch, branchIndex, key))
  };
}

function mapStep(step: JenkinsWorkflowStep, index: number, parentKey: string): PipelineStep {
  const key = buildStageKey(step.id ?? step.name ?? "step", index, parentKey);
  return {
    key,
    name: step.name ?? "Step",
    status: step.status,
    durationMillis: step.durationMillis
  };
}

function getStageSteps(stage: JenkinsWorkflowStage): JenkinsWorkflowStep[] {
  if (Array.isArray(stage.stageFlowNodes)) {
    return stage.stageFlowNodes;
  }
  if (Array.isArray(stage.steps)) {
    return stage.steps;
  }
  return [];
}

function getStageBranches(stage: JenkinsWorkflowStage): JenkinsWorkflowStage[] {
  if (Array.isArray(stage.parallelStages)) {
    return stage.parallelStages;
  }
  if (Array.isArray(stage.branches)) {
    return stage.branches;
  }
  if (Array.isArray(stage.children)) {
    return stage.children;
  }
  return [];
}

function buildStageKey(base: string, index: number, parentKey?: string): string {
  const sanitized = base.trim() || "stage";
  const suffix = `${sanitized}-${index}`;
  return parentKey ? `${parentKey}::${suffix}` : `stage::${suffix}`;
}

function pickNumber(primary?: number, fallback?: number): number | undefined {
  if (typeof primary === "number" && Number.isFinite(primary)) {
    return primary;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  return undefined;
}

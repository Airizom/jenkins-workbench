import { pickFiniteNumber } from "../../shared/numbers";
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
    nodeId: normalizeNodeId(stage.id),
    name: stage.name ?? "Stage",
    status: stage.status,
    durationMillis: pickFiniteNumber(stage.durationMillis, stage.execDurationMillis),
    steps: steps.map((step, stepIndex) => mapStep(step, stepIndex, key)),
    parallelBranches: branches.map((branch, branchIndex) => mapStage(branch, branchIndex, key))
  };
}

function mapStep(step: JenkinsWorkflowStep, index: number, parentKey: string): PipelineStep {
  const key = buildStageKey(step.id ?? step.name ?? "step", index, parentKey);
  return {
    key,
    nodeId: normalizeNodeId(step.id),
    name: step.name ?? "Step",
    status: step.status,
    durationMillis: step.durationMillis
  };
}

function normalizeNodeId(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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

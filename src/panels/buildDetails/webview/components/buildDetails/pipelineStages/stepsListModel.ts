import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel
} from "../../../../shared/BuildDetailsContracts";

export interface StepRowViewModel {
  key: string;
  name: string;
  statusClass: string;
  durationLabel: string;
  logLabel: string;
  logTarget?: PipelineLogTargetViewModel;
}

export function buildStepRows(steps: PipelineStageStepViewModel[]): StepRowViewModel[] {
  return steps.map((step, index) => ({
    key: `${step.name}-${index}`,
    name: step.name || "Step",
    statusClass: step.statusClass,
    durationLabel: step.durationLabel || "—",
    logLabel: `Open log for ${step.name.trim() || "step"}`,
    logTarget: step.logTarget
  }));
}

export function getStepRowPaddingClass(compact: boolean): string {
  return compact ? "px-2 py-1" : "px-2.5 py-1.5";
}

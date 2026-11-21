import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
import { formatCount } from "./pipelineStagesUtils";

// Jenkins reports skipped stages as neutral with a zero duration; "0ms" reads
// as a real (suspiciously fast) run, so those stages are labelled as not run.
export function isStageNotRun(stage: PipelineStageViewModel): boolean {
  return stage.statusClass === "neutral" && stage.durationMs === 0;
}

export function describeStageMeta(stage: PipelineStageViewModel): string {
  const parts = [isStageNotRun(stage) ? "Did not run" : stage.durationLabel || "Unknown"];
  const branchCount = stage.parallelBranches.length;
  if (branchCount > 0) {
    parts.push(formatCount(branchCount, "parallel branch", "parallel branches"));
  }
  return parts.join(" · ");
}

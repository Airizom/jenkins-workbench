import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
export function getStageId(stage: PipelineStageViewModel, index: number): string {
  if (typeof stage.key === "string" && stage.key.length > 0) {
    return stage.key;
  }
  if (typeof stage.name === "string" && stage.name.length > 0) {
    return `${stage.name}-${index}`;
  }
  return `stage-${index}`;
}
const FAILED_ONLY_STATUSES = new Set(["failure", "unstable"]);

function hasFailedSteps(stage: PipelineStageViewModel): boolean {
  return (
    stage.stepsFailedOnly.length > 0 ||
    stage.parallelBranches.some((branch) => hasFailedSteps(branch))
  );
}

/**
 * Steps start filtered to failures only for a failed or unstable stage that
 * has failed steps to show; every other stage lists all of its steps.
 */
export function defaultShowAllSteps(stage: PipelineStageViewModel): boolean {
  return !(FAILED_ONLY_STATUSES.has(stage.statusClass) && hasFailedSteps(stage));
}

export function pruneStageFlags(
  prev: Record<string, boolean>,
  validKeys: Set<string>
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(prev)) {
    if (validKeys.has(key)) {
      next[key] = value;
    }
  }
  return next;
}

/** "1 branch", "2 branches": count followed by the correctly numbered noun. */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

/** Screen-reader status text; the visual status is an icon plus color. */
export function formatStatusText(statusLabel: string | undefined): string {
  const label = statusLabel?.trim();
  return label ? label : "Status unknown";
}

import type { BuildCompareStageDiffItem } from "../../../shared/BuildCompareContracts";

// An aborted stage did not complete, so it ranks with unstable: worse than success, below failure.
const STATUS_SEVERITY: Record<string, number> = { unstable: 1, aborted: 1, failure: 2 };

function statusSeverity(statusClass?: string): number {
  return STATUS_SEVERITY[statusClass ?? ""] ?? 0;
}

/** A matched stage whose result got worse (e.g. success → failure). */
export function isStageStatusRegression(item: BuildCompareStageDiffItem): boolean {
  return (
    item.changeType === "matched" &&
    statusSeverity(item.targetStatusClass) > statusSeverity(item.baselineStatusClass)
  );
}

/** A stage that only exists in the target build and did not succeed there. */
export function isNewUnsuccessfulStage(item: BuildCompareStageDiffItem): boolean {
  return item.changeType === "added" && statusSeverity(item.targetStatusClass) > 0;
}

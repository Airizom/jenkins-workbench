import type { BuildCompareStageDiffItem } from "../../../shared/BuildCompareContracts";

const STATUS_SEVERITY: Record<string, number> = { unstable: 1, failure: 2 };

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

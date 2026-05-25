import type { BuildCompareStageDiffItem } from "../../../shared/BuildCompareContracts";
import { StageValueCell } from "./StageValueCell";
import { CompareDiffRowShell } from "./shared/CompareDiffRowShell";
import { ValueCell } from "./shared/ValueCell";

export function StageDiffRow({ item }: { item: BuildCompareStageDiffItem }) {
  return (
    <CompareDiffRowShell title={item.name} changeType={item.changeType} titleClassName="truncate">
      <div className="grid gap-2 text-xs sm:grid-cols-3 sm:gap-4">
        <StageValueCell
          label="Baseline"
          status={item.baselineStatusLabel}
          statusClass={item.baselineStatusClass}
          duration={item.baselineDurationLabel}
        />
        <StageValueCell
          label="Target"
          status={item.targetStatusLabel}
          statusClass={item.targetStatusClass}
          duration={item.targetDurationLabel}
        />
        <ValueCell label="Delta" value={item.deltaLabel ?? "-"} />
      </div>
    </CompareDiffRowShell>
  );
}

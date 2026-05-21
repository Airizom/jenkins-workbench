import type { BuildCompareStageDiffItem } from "../../../shared/BuildCompareContracts";
import { StageValueCell } from "./StageValueCell";
import { ValueCell } from "./shared/ValueCell";

export function StageDiffRow({ item }: { item: BuildCompareStageDiffItem }) {
  return (
    <div className="rounded-lg border border-border bg-muted-soft px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="mt-1 text-xs capitalize text-muted-foreground">{item.changeType}</p>
        </div>
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
      </div>
    </div>
  );
}

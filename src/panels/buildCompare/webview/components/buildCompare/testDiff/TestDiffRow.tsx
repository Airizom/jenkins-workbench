import { formatTestCaseSubtitle } from "../../../../../shared/TestCaseViewModel";
import type { BuildCompareTestDiffItem } from "../../../../shared/BuildCompareContracts";
import { CompareDiffRowShell } from "../shared/CompareDiffRowShell";
import { CompareSideGrid } from "../shared/CompareSideGrid";
export function TestDiffRow({ item }: { item: BuildCompareTestDiffItem }) {
  return (
    <CompareDiffRowShell
      title={item.name}
      subtitle={formatTestCaseSubtitle(item.className, item.suiteName)}
      titleClassName="truncate"
      align="center"
    >
      <CompareSideGrid className="text-right">
        <div>
          <p className="text-muted-foreground">Baseline</p>
          <p>{item.baselineStatusLabel}</p>
          {item.baselineDurationLabel ? (
            <p className="text-muted-foreground">{item.baselineDurationLabel}</p>
          ) : null}
        </div>
        <div>
          <p className="text-muted-foreground">Target</p>
          <p>{item.targetStatusLabel}</p>
          {item.targetDurationLabel ? (
            <p className="text-muted-foreground">{item.targetDurationLabel}</p>
          ) : null}
        </div>
      </CompareSideGrid>
    </CompareDiffRowShell>
  );
}

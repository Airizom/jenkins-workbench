import { formatTestCaseSubtitle } from "../../../../../shared/TestCaseViewModel";
import {
  type StatusVisualTone,
  resolveMetricToneClass
} from "../../../../../shared/TestStatusStyles";
import type { BuildCompareTestDiffItem } from "../../../../shared/BuildCompareContracts";
import { CompareDiffRowShell } from "../shared/CompareDiffRowShell";
import { CompareSideGrid } from "../shared/CompareSideGrid";

function resolveTestStatusClass(tone?: StatusVisualTone): string | undefined {
  return tone !== undefined ? resolveMetricToneClass(tone) : undefined;
}
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
          <p className={resolveTestStatusClass(item.baselineStatusTone)}>
            {item.baselineStatusLabel}
          </p>
          {item.baselineDurationLabel ? (
            <p className="text-muted-foreground">{item.baselineDurationLabel}</p>
          ) : null}
        </div>
        <div>
          <p className="text-muted-foreground">Target</p>
          <p className={resolveTestStatusClass(item.targetStatusTone)}>{item.targetStatusLabel}</p>
          {item.targetDurationLabel ? (
            <p className="text-muted-foreground">{item.targetDurationLabel}</p>
          ) : null}
        </div>
      </CompareSideGrid>
    </CompareDiffRowShell>
  );
}

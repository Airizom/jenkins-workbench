import { formatTestCaseSubtitle } from "../../../../../shared/TestCaseViewModel";
import {
  resolveMetricToneClass,
  type StatusVisualTone
} from "../../../../../shared/TestStatusStyles";
import type { BuildCompareTestDiffItem } from "../../../../shared/BuildCompareContracts";
import { CompareDiffRowShell } from "../shared/CompareDiffRowShell";
import { CompareSideGrid } from "../shared/CompareSideGrid";

function TestStatusCell({
  label,
  status,
  tone,
  duration
}: {
  label: string;
  status: string;
  tone?: StatusVisualTone;
  duration?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className={tone !== undefined ? resolveMetricToneClass(tone) : undefined}>{status}</p>
      {duration ? <p className="text-muted-foreground">{duration}</p> : null}
    </div>
  );
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
        <TestStatusCell
          label="Baseline"
          status={item.baselineStatusLabel}
          tone={item.baselineStatusTone}
          duration={item.baselineDurationLabel}
        />
        <TestStatusCell
          label="Target"
          status={item.targetStatusLabel}
          tone={item.targetStatusTone}
          duration={item.targetDurationLabel}
        />
      </CompareSideGrid>
    </CompareDiffRowShell>
  );
}

import type { BuildCompareParameterDiffItem } from "../../../shared/BuildCompareContracts";
import { CompareDiffRowShell } from "./shared/CompareDiffRowShell";
import { CompareSideGrid } from "./shared/CompareSideGrid";
import { ValueCell } from "./shared/ValueCell";
export function ParameterDiffRow({ item }: { item: BuildCompareParameterDiffItem }) {
  return (
    <CompareDiffRowShell title={item.name} changeType={item.changeType}>
      <CompareSideGrid>
        <ValueCell label="Baseline" value={item.baselineValue} />
        <ValueCell label="Target" value={item.targetValue} />
      </CompareSideGrid>
    </CompareDiffRowShell>
  );
}

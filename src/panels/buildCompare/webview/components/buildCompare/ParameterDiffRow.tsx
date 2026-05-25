import type { BuildCompareParameterDiffItem } from "../../../shared/BuildCompareContracts";
import { CompareDiffRowShell } from "./shared/CompareDiffRowShell";
import { ValueCell } from "./shared/ValueCell";

export function ParameterDiffRow({ item }: { item: BuildCompareParameterDiffItem }) {
  return (
    <CompareDiffRowShell title={item.name} changeType={item.changeType}>
      <div className="grid min-w-0 gap-2 text-xs sm:grid-cols-2 sm:gap-4">
        <ValueCell label="Baseline" value={item.baselineValue} />
        <ValueCell label="Target" value={item.targetValue} />
      </div>
    </CompareDiffRowShell>
  );
}

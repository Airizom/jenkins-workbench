import type { BuildCompareParameterDiffItem } from "../../../shared/BuildCompareContracts";
import { ValueCell } from "./shared/ValueCell";

export function ParameterDiffRow({ item }: { item: BuildCompareParameterDiffItem }) {
  return (
    <div className="rounded-lg border border-border bg-muted-soft px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.name}</p>
          <p className="mt-1 text-xs text-muted-foreground capitalize">{item.changeType}</p>
        </div>
        <div className="grid min-w-0 gap-2 text-xs sm:grid-cols-2 sm:gap-4">
          <ValueCell label="Baseline" value={item.baselineValue} />
          <ValueCell label="Target" value={item.targetValue} />
        </div>
      </div>
    </div>
  );
}

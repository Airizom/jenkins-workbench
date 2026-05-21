import type { BuildCompareTestDiffItem } from "../../../../shared/BuildCompareContracts";

export function TestDiffRow({ item }: { item: BuildCompareTestDiffItem }) {
  return (
    <div className="rounded-lg border border-border bg-muted-soft px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[item.className, item.suiteName].filter(Boolean).join(" • ") || "Unnamed suite"}
          </p>
        </div>
        <div className="grid gap-2 text-right text-xs sm:grid-cols-2 sm:gap-4">
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
        </div>
      </div>
    </div>
  );
}

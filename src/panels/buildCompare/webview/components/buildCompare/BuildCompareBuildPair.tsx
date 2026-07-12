import { ArrowDownIcon } from "../../../../shared/webview/icons";
import type { BuildCompareBuildViewModel } from "../../../shared/BuildCompareContracts";
import { BuildCard } from "./BuildCard";
export function BuildCompareBuildPair({
  baseline,
  target
}: {
  baseline: BuildCompareBuildViewModel;
  target: BuildCompareBuildViewModel;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
      <BuildCard build={baseline} side="baseline" />
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted-soft px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <span>Baseline</span>
          <ArrowDownIcon className="h-3 w-3 shrink-0 lg:hidden" aria-hidden="true" />
          <span aria-hidden="true" className="hidden lg:inline">
            -&gt;
          </span>
          <span className="sr-only">to</span>
          <span>Target</span>
        </div>
      </div>
      <BuildCard build={target} side="target" />
    </section>
  );
}

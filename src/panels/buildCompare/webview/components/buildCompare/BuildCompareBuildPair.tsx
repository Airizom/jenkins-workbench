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
      <div className="hidden items-center justify-center lg:flex">
        <div className="rounded-full border border-border bg-muted-soft px-3 py-1 text-xs font-medium text-muted-foreground">
          baseline -&gt; target
        </div>
      </div>
      <BuildCard build={target} side="target" />
    </section>
  );
}

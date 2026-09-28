import { ArrowDownIcon } from "../../../../shared/webview/icons";
import type { BuildCompareBuildViewModel } from "../../../shared/BuildCompareContracts";
import { BuildCard } from "./BuildCard";
import { haveDifferentJobs } from "./buildIdentity";

export function BuildCompareBuildPair({
  baseline,
  target
}: {
  baseline: BuildCompareBuildViewModel;
  target: BuildCompareBuildViewModel;
}) {
  const showJob = haveDifferentJobs(baseline, target);
  return (
    <section
      aria-label="Compared builds"
      className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch"
    >
      <BuildCard build={baseline} side="baseline" showJob={showJob} />
      <div className="flex items-center justify-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
          <ArrowDownIcon className="h-3.5 w-3.5 lg:-rotate-90" aria-hidden="true" />
          <span className="sr-only">Baseline compared to target</span>
        </div>
      </div>
      <BuildCard build={target} side="target" showJob={showJob} />
    </section>
  );
}

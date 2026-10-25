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
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch sm:gap-3"
    >
      <BuildCard build={baseline} side="baseline" showJob={showJob} />
      <div className="flex items-center justify-center">
        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
          <ArrowDownIcon className="h-3.5 w-3.5 sm:-rotate-90" aria-hidden="true" />
          <span className="sr-only">Baseline compared to target</span>
        </div>
      </div>
      <BuildCard build={target} side="target" showJob={showJob} />
    </section>
  );
}

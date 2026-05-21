import type { BuildCompareTestsSectionViewModel } from "../../../shared/BuildCompareContracts";
import { SectionCard } from "./shared/SectionCard";
import { SummaryStat } from "./shared/SummaryStat";
import { DiffList } from "./testDiff/DiffList";

export function TestDiffSection({ section }: { section: BuildCompareTestsSectionViewModel }) {
  return (
    <SectionCard
      title="Test Diff"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <SummaryStat label="Baseline" value={section.baselineSummaryLabel} />
        <SummaryStat label="Target" value={section.targetSummaryLabel} />
      </div>
      <DiffList title="New Failures" items={section.newFailures} emptyLabel="No new failures." />
      <DiffList
        title="Still Failing"
        items={section.stillFailing}
        emptyLabel="No still-failing tests."
      />
      <DiffList
        title="Newly Passing"
        items={section.newPasses}
        emptyLabel="No newly passing tests."
      />
      <DiffList title="Added Tests" items={section.addedTests} emptyLabel="No added tests." />
      <DiffList title="Removed Tests" items={section.removedTests} emptyLabel="No removed tests." />
      <div className="grid gap-3 lg:grid-cols-2">
        <SummaryStat label="Other test changes" value={String(section.otherChangesCount)} />
        <SummaryStat label="Unchanged tests" value={String(section.unchangedCount)} />
      </div>
    </SectionCard>
  );
}

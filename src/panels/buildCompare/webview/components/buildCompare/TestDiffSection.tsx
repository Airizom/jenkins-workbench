import type {
  BuildCompareTestDiffItem,
  BuildCompareTestsSectionViewModel
} from "../../../shared/BuildCompareContracts";
import { EmptyState } from "./shared/EmptyState";
import { SectionCard } from "./shared/SectionCard";
import { SummaryStat } from "./shared/SummaryStat";
import { DiffList } from "./testDiff/DiffList";

const DIFF_GROUPS: Array<{
  title: string;
  emptyLabel: string;
  select: (section: BuildCompareTestsSectionViewModel) => BuildCompareTestDiffItem[];
}> = [
  { title: "New Failures", emptyLabel: "No new failures.", select: (s) => s.newFailures },
  { title: "Still Failing", emptyLabel: "No still-failing tests.", select: (s) => s.stillFailing },
  { title: "Newly Passing", emptyLabel: "No newly passing tests.", select: (s) => s.newPasses },
  { title: "Added Tests", emptyLabel: "No added tests.", select: (s) => s.addedTests },
  { title: "Removed Tests", emptyLabel: "No removed tests.", select: (s) => s.removedTests }
];
export function TestDiffSection({ section }: { section: BuildCompareTestsSectionViewModel }) {
  const visibleGroups = DIFF_GROUPS.map((group) => ({
    ...group,
    items: group.select(section)
  })).filter((group) => group.items.length > 0);
  const hasTestChanges = visibleGroups.length > 0 || section.otherChangesCount > 0;
  const comparisonAvailable = section.status === "available" || section.status === "empty";

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
      {visibleGroups.map((group) => (
        <DiffList
          key={group.title}
          title={group.title}
          items={group.items}
          emptyLabel={group.emptyLabel}
        />
      ))}
      {!comparisonAvailable ? (
        <EmptyState label={section.detail ?? section.summaryLabel} />
      ) : hasTestChanges ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <SummaryStat label="Other test changes" value={String(section.otherChangesCount)} />
          <SummaryStat label="Unchanged tests" value={String(section.unchangedCount)} />
        </div>
      ) : (
        <EmptyState tone="success" label="No test changes between these builds." />
      )}
    </SectionCard>
  );
}

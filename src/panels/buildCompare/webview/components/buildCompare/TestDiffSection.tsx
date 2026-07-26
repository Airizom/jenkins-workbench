import type { BuildCompareTestsSectionViewModel } from "../../../shared/BuildCompareContracts";
import { EmptyState } from "./shared/EmptyState";
import { SectionCard } from "./shared/SectionCard";
import { SummaryStat } from "./shared/SummaryStat";
import { DiffList } from "./testDiff/DiffList";

const DIFF_GROUPS = [
  { title: "New Failures", emptyLabel: "No new failures.", itemsKey: "newFailures" },
  { title: "Still Failing", emptyLabel: "No still-failing tests.", itemsKey: "stillFailing" },
  { title: "Newly Passing", emptyLabel: "No newly passing tests.", itemsKey: "newPasses" },
  { title: "Added Tests", emptyLabel: "No added tests.", itemsKey: "addedTests" },
  { title: "Removed Tests", emptyLabel: "No removed tests.", itemsKey: "removedTests" }
] as const;

function TestChangesSummary({
  section,
  hasTestChanges
}: {
  section: BuildCompareTestsSectionViewModel;
  hasTestChanges: boolean;
}) {
  const comparisonAvailable = section.status === "available" || section.status === "empty";

  if (!comparisonAvailable) {
    return <EmptyState label={section.detail ?? section.summaryLabel} />;
  }

  if (!hasTestChanges) {
    return <EmptyState tone="success" label="No test changes between these builds." />;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <SummaryStat label="Other test changes" value={String(section.otherChangesCount)} />
      <SummaryStat label="Unchanged tests" value={String(section.unchangedCount)} />
    </div>
  );
}

export function TestDiffSection({ section }: { section: BuildCompareTestsSectionViewModel }) {
  const visibleGroups = DIFF_GROUPS.map((group) => ({
    ...group,
    items: section[group.itemsKey]
  })).filter((group) => group.items.length > 0);
  const hasTestChanges = visibleGroups.length > 0 || section.otherChangesCount > 0;

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
      <TestChangesSummary section={section} hasTestChanges={hasTestChanges} />
    </SectionCard>
  );
}

import type {
  BuildCompareTestDiffItem,
  BuildCompareTestsSectionViewModel
} from "../../../shared/BuildCompareContracts";
import { CompareEmptyState } from "./shared/CompareEmptyState";
import { SectionCard, type SectionCardDisclosureProps } from "./shared/SectionCard";
import { SummaryStat } from "./shared/SummaryStat";
import { AmbiguousDiffList, DiffList } from "./testDiff/DiffList";

type DiffGroup = {
  title: string;
  itemsKey: keyof Pick<
    BuildCompareTestsSectionViewModel,
    "newFailures" | "stillFailing" | "newPasses" | "otherChanges" | "addedTests" | "removedTests"
  >;
  tone?: "failure";
  description?: string;
};

const DIFF_GROUPS: DiffGroup[] = [
  { title: "New failures", itemsKey: "newFailures", tone: "failure" },
  { title: "Still failing", itemsKey: "stillFailing", tone: "failure" },
  { title: "Newly passing", itemsKey: "newPasses" },
  {
    title: "Other status changes",
    itemsKey: "otherChanges",
    description: "Status changed between builds without becoming a failure or a pass."
  },
  { title: "Added tests", itemsKey: "addedTests" },
  { title: "Removed tests", itemsKey: "removedTests" }
];

function UnchangedNote({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <p className="text-xs text-muted-foreground">
      {count.toLocaleString()} {count === 1 ? "test" : "tests"} unchanged
    </p>
  );
}

export function TestDiffSection({
  section,
  ...disclosure
}: { section: BuildCompareTestsSectionViewModel } & SectionCardDisclosureProps) {
  const visibleGroups = DIFF_GROUPS.map((group) => ({
    ...group,
    items: section[group.itemsKey] as BuildCompareTestDiffItem[]
  })).filter((group) => group.items.length > 0);
  const hasTestChanges = visibleGroups.length > 0 || section.ambiguousTests.length > 0;
  const comparisonAvailable = section.status === "available" || section.status === "empty";

  return (
    <SectionCard
      title="Tests"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
      {...disclosure}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryStat label="Baseline" value={section.baselineSummaryLabel} />
        <SummaryStat label="Target" value={section.targetSummaryLabel} />
      </div>
      {!comparisonAvailable ? (
        <CompareEmptyState label={section.detail ?? section.summaryLabel} />
      ) : hasTestChanges ? null : (
        <CompareEmptyState tone="success" label="No test changes between these builds." />
      )}
      {visibleGroups.map((group) => (
        <DiffList
          key={group.title}
          title={group.title}
          items={group.items}
          tone={group.tone}
          description={group.description}
        />
      ))}
      {section.ambiguousTests.length > 0 ? (
        <AmbiguousDiffList items={section.ambiguousTests} />
      ) : null}
      {comparisonAvailable ? <UnchangedNote count={section.unchangedCount} /> : null}
    </SectionCard>
  );
}

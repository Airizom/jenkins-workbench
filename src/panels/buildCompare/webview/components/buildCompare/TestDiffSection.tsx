import * as React from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Input } from "../../../../shared/webview/components/ui/input";
import type {
  BuildCompareTestDiffItem,
  BuildCompareTestsSectionViewModel
} from "../../../shared/BuildCompareContracts";
import { SectionCard, type SectionCardDisclosureProps } from "./shared/SectionCard";
import { SummaryStat } from "./shared/SummaryStat";
import { AmbiguousDiffList, DiffList } from "./testDiff/DiffList";
import {
  filterTestDiffItems,
  normalizeTestDiffQuery,
  TEST_DIFF_SEARCH_MIN_ITEMS
} from "./testDiff/testDiffModel";

const { useId, useState } = React;

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

function TestSearch({
  query,
  matchCount,
  totalCount,
  onQueryChange
}: {
  query: string;
  matchCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
}) {
  const statusId = useId();
  const filtering = normalizeTestDiffQuery(query).length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        aria-label="Search changed tests by suite, class, or name"
        aria-describedby={statusId}
        placeholder="Search changed tests"
        className="w-72 max-w-full"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <p id={statusId} role="status" className="text-xs text-muted-foreground tabular-nums">
        {filtering
          ? `${matchCount.toLocaleString()} of ${totalCount.toLocaleString()} changed tests match`
          : `${totalCount.toLocaleString()} changed tests`}
      </p>
    </div>
  );
}

export function TestDiffSection({
  section,
  ...disclosure
}: { section: BuildCompareTestsSectionViewModel } & SectionCardDisclosureProps) {
  const [query, setQuery] = useState("");
  const groups = DIFF_GROUPS.map((group) => {
    const all = section[group.itemsKey] as BuildCompareTestDiffItem[];
    return { ...group, total: all.length, items: filterTestDiffItems(all, query) };
  }).filter((group) => group.total > 0);
  const ambiguous = filterTestDiffItems(section.ambiguousTests, query);
  const totalCount =
    groups.reduce((sum, group) => sum + group.total, 0) + section.ambiguousTests.length;
  const matchCount = groups.reduce((sum, group) => sum + group.items.length, 0) + ambiguous.length;
  const comparisonAvailable = section.status === "available" || section.status === "empty";
  // Paging state belongs to one result set; a new query starts each group at page one.
  const listKey = normalizeTestDiffQuery(query);

  // Unavailable, failed, or unchanged comparisons say so in the heading summary;
  // the body only adds the per-build counts.
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
      {totalCount >= TEST_DIFF_SEARCH_MIN_ITEMS ? (
        <TestSearch
          query={query}
          matchCount={matchCount}
          totalCount={totalCount}
          onQueryChange={setQuery}
        />
      ) : null}
      {totalCount > 0 && matchCount === 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          No matching tests.
          <Button variant="outline" size="xs" onClick={() => setQuery("")}>
            Clear search
          </Button>
        </div>
      ) : null}
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <DiffList
            key={`${group.title}:${listKey}`}
            title={group.title}
            items={group.items}
            total={group.total}
            tone={group.tone}
            description={group.description}
          />
        ))}
      {ambiguous.length > 0 ? (
        <AmbiguousDiffList
          key={`ambiguous:${listKey}`}
          items={ambiguous}
          total={section.ambiguousTests.length}
        />
      ) : null}
      {comparisonAvailable ? <UnchangedNote count={section.unchangedCount} /> : null}
    </SectionCard>
  );
}

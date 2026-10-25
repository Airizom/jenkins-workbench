import * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import type {
  BuildCompareAmbiguousTestItem,
  BuildCompareTestDiffItem
} from "../../../../shared/BuildCompareContracts";
import { CompareSectionFrame } from "../shared/CompareSectionFrame";
import { CompareTable } from "../shared/CompareTable";
import { AmbiguousTestRow, TestDiffRow } from "./TestDiffRow";
import { showMoreTestsLabel, TEST_DIFF_PAGE_SIZE } from "./testDiffModel";

const { useState } = React;

/** Test name first; the per-build columns stay narrow so statuses sit near the name. */
const TEST_COLUMNS = [
  { label: "Test" },
  { label: "Baseline", className: "w-[20%]" },
  { label: "Target", className: "w-[20%]" }
];

/** Renders the first page of a group as one table and reveals the rest a page at a time. */
function PagedTestTable<T>({
  caption,
  items,
  renderRow
}: {
  caption: string;
  items: T[];
  renderRow: (item: T) => React.ReactNode;
}) {
  const [visibleCount, setVisibleCount] = useState(TEST_DIFF_PAGE_SIZE);
  const remaining = items.length - visibleCount;
  return (
    <>
      <CompareTable caption={caption} columns={TEST_COLUMNS}>
        {items.slice(0, visibleCount).map(renderRow)}
      </CompareTable>
      {remaining > 0 ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVisibleCount((count) => count + TEST_DIFF_PAGE_SIZE)}
        >
          {showMoreTestsLabel(remaining)}
        </Button>
      ) : null}
    </>
  );
}

export function DiffList({
  title,
  items,
  total,
  description,
  tone
}: {
  title: string;
  items: BuildCompareTestDiffItem[];
  /** Unfiltered group size, shown as "N of total" while a search narrows the group. */
  total?: number;
  description?: string;
  tone?: "neutral" | "failure";
}) {
  return (
    <CompareSectionFrame
      title={title}
      count={items.length}
      total={total}
      description={description}
      tone={tone}
    >
      <PagedTestTable
        caption={title}
        items={items}
        renderRow={(item) => <TestDiffRow key={item.key} item={item} />}
      />
    </CompareSectionFrame>
  );
}

export function AmbiguousDiffList({
  items,
  total
}: {
  items: BuildCompareAmbiguousTestItem[];
  total?: number;
}) {
  return (
    <CompareSectionFrame
      title="Ambiguous"
      count={items.length}
      total={total}
      description="Duplicate test identity — can't be matched reliably between builds. These tests are not counted as passing, failing, added, or removed."
    >
      <PagedTestTable
        caption="Ambiguous tests"
        items={items}
        renderRow={(item) => <AmbiguousTestRow key={item.key} item={item} />}
      />
    </CompareSectionFrame>
  );
}

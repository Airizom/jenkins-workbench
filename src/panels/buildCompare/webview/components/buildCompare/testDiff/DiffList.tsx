import * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import type {
  BuildCompareAmbiguousTestItem,
  BuildCompareTestDiffItem
} from "../../../../shared/BuildCompareContracts";
import { CompareSectionFrame } from "../shared/CompareSectionFrame";
import { AmbiguousTestRow, TestDiffRow } from "./TestDiffRow";
import { showMoreTestsLabel, TEST_DIFF_PAGE_SIZE } from "./testDiffModel";

const { useState } = React;

/** Renders the first page of a group and reveals the rest a page at a time. */
function PagedItems<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  const [visibleCount, setVisibleCount] = useState(TEST_DIFF_PAGE_SIZE);
  const remaining = items.length - visibleCount;
  return (
    <>
      {items.slice(0, visibleCount).map(render)}
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
      <PagedItems items={items} render={(item) => <TestDiffRow key={item.key} item={item} />} />
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
      <PagedItems
        items={items}
        render={(item) => <AmbiguousTestRow key={item.key} item={item} />}
      />
    </CompareSectionFrame>
  );
}

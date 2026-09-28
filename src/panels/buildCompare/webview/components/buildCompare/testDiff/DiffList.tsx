import type {
  BuildCompareAmbiguousTestItem,
  BuildCompareTestDiffItem
} from "../../../../shared/BuildCompareContracts";
import { CompareSectionFrame } from "../shared/CompareSectionFrame";
import { AmbiguousTestRow, TestDiffRow } from "./TestDiffRow";

export function DiffList({
  title,
  items,
  description,
  tone
}: {
  title: string;
  items: BuildCompareTestDiffItem[];
  description?: string;
  tone?: "neutral" | "failure";
}) {
  return (
    <CompareSectionFrame title={title} count={items.length} description={description} tone={tone}>
      {items.map((item) => (
        <TestDiffRow key={item.key} item={item} />
      ))}
    </CompareSectionFrame>
  );
}

export function AmbiguousDiffList({ items }: { items: BuildCompareAmbiguousTestItem[] }) {
  return (
    <CompareSectionFrame
      title="Ambiguous"
      count={items.length}
      description="Duplicate test identity — can't be matched reliably between builds. These tests are not counted as passing, failing, added, or removed."
    >
      {items.map((item) => (
        <AmbiguousTestRow key={item.key} item={item} />
      ))}
    </CompareSectionFrame>
  );
}

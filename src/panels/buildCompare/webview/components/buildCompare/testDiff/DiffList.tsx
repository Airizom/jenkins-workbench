import type { BuildCompareTestDiffItem } from "../../../../shared/BuildCompareContracts";
import { CompareSectionFrame } from "../shared/CompareSectionFrame";
import { TestDiffRow } from "./TestDiffRow";

export function DiffList({
  title,
  items,
  emptyLabel
}: {
  title: string;
  items: BuildCompareTestDiffItem[];
  emptyLabel: string;
}) {
  return (
    <CompareSectionFrame title={title} count={items.length} emptyLabel={emptyLabel}>
      {items.map((item) => (
        <TestDiffRow key={item.key} item={item} />
      ))}
    </CompareSectionFrame>
  );
}

import type { BuildCompareTestDiffItem } from "../../../../shared/BuildCompareContracts";
import { CompareSectionFrame } from "../shared/CompareSectionFrame";
import { TestDiffRow } from "./TestDiffRow";
export function DiffList({ title, items }: { title: string; items: BuildCompareTestDiffItem[] }) {
  return (
    <CompareSectionFrame title={title} count={items.length}>
      {items.map((item) => (
        <TestDiffRow key={item.key} item={item} />
      ))}
    </CompareSectionFrame>
  );
}

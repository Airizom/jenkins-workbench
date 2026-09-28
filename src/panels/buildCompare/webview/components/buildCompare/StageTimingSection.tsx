import type { BuildCompareStagesSectionViewModel } from "../../../shared/BuildCompareContracts";
import { StageDiffRow } from "./StageDiffRow";
import { CompareItemsSection } from "./shared/CompareItemsSection";
import { CompareTable } from "./shared/CompareTable";
import type { SectionCardDisclosureProps } from "./shared/SectionCard";

const STAGE_COLUMNS = [
  { label: "Stage" },
  { label: "Baseline", className: "w-[24%]" },
  { label: "Target", className: "w-[24%]" },
  { label: "Change", className: "w-28 text-right" }
];

export function StageTimingSection({
  section,
  ...disclosure
}: { section: BuildCompareStagesSectionViewModel } & SectionCardDisclosureProps) {
  return (
    <CompareItemsSection
      title="Stages"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
      items={section.items}
      emptyLabel="No pipeline stage data to compare."
      {...disclosure}
      renderItems={(items) => (
        <CompareTable caption="Stage timing by build" columns={STAGE_COLUMNS}>
          {items.map((item) => (
            <StageDiffRow key={item.key} item={item} />
          ))}
        </CompareTable>
      )}
    />
  );
}

import type { BuildCompareParametersSectionViewModel } from "../../../shared/BuildCompareContracts";
import { ParameterDiffRow } from "./ParameterDiffRow";
import { CompareItemsSection } from "./shared/CompareItemsSection";
import { CompareTable } from "./shared/CompareTable";
import type { SectionCardDisclosureProps } from "./shared/SectionCard";

const PARAMETER_COLUMNS = [
  { label: "Parameter", className: "w-[30%]" },
  { label: "Baseline", className: "w-[35%]" },
  { label: "Target", className: "w-[35%]" }
];

export function ParameterDiffSection({
  section,
  ...disclosure
}: {
  section: BuildCompareParametersSectionViewModel;
} & SectionCardDisclosureProps) {
  return (
    <CompareItemsSection
      title="Parameters"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
      items={section.items}
      emptyLabel="No changed parameters."
      {...disclosure}
      renderItems={(items) => (
        <CompareTable caption="Changed build parameters" columns={PARAMETER_COLUMNS}>
          {items.map((item) => (
            <ParameterDiffRow key={`${item.changeType}:${item.name}`} item={item} />
          ))}
        </CompareTable>
      )}
    />
  );
}

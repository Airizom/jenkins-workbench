import type { BuildCompareParametersSectionViewModel } from "../../../shared/BuildCompareContracts";
import { ParameterDiffRow } from "./ParameterDiffRow";
import { CompareItemsSection } from "./shared/CompareItemsSection";

export function ParameterDiffSection({
  section
}: {
  section: BuildCompareParametersSectionViewModel;
}) {
  return (
    <CompareItemsSection
      title="Parameter Diff"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
      items={section.items}
      emptyLabel="No changed parameters."
      itemKey={(item) => `${item.changeType}:${item.name}`}
      renderItem={(item) => <ParameterDiffRow item={item} />}
    />
  );
}

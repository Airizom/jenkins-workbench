import type { BuildCompareStagesSectionViewModel } from "../../../shared/BuildCompareContracts";
import { StageDiffRow } from "./StageDiffRow";
import { CompareItemsSection } from "./shared/CompareItemsSection";
export function StageTimingSection({ section }: { section: BuildCompareStagesSectionViewModel }) {
  return (
    <CompareItemsSection
      title="Stage Timing"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
      items={section.items}
      emptyLabel="No pipeline stage data to compare."
      itemKey={(item) => `${item.changeType}:${item.name}`}
      renderItem={(item) => <StageDiffRow item={item} />}
    />
  );
}

import type { BuildCompareStagesSectionViewModel } from "../../../shared/BuildCompareContracts";
import { StageDiffRow } from "./StageDiffRow";
import { EmptyState } from "./shared/EmptyState";
import { SectionCard } from "./shared/SectionCard";

export function StageTimingSection({ section }: { section: BuildCompareStagesSectionViewModel }) {
  return (
    <SectionCard
      title="Stage Timing"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
    >
      {section.items.length > 0 ? (
        <div className="space-y-2">
          {section.items.map((item) => (
            <StageDiffRow key={`${item.changeType}:${item.name}`} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState label="No pipeline stage data to compare." />
      )}
    </SectionCard>
  );
}

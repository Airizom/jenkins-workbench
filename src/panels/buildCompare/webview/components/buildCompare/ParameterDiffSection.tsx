import type { BuildCompareParametersSectionViewModel } from "../../../shared/BuildCompareContracts";
import { ParameterDiffRow } from "./ParameterDiffRow";
import { EmptyState } from "./shared/EmptyState";
import { SectionCard } from "./shared/SectionCard";

export function ParameterDiffSection({
  section
}: {
  section: BuildCompareParametersSectionViewModel;
}) {
  return (
    <SectionCard
      title="Parameter Diff"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
    >
      {section.items.length > 0 ? (
        <div className="space-y-2">
          {section.items.map((item) => (
            <ParameterDiffRow key={`${item.changeType}:${item.name}`} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState label="No changed parameters." />
      )}
    </SectionCard>
  );
}

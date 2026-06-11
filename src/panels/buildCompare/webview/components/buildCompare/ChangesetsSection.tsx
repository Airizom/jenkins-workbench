import type { BuildCompareChangesetsSectionViewModel } from "../../../shared/BuildCompareContracts";
import { ChangesetColumn } from "./ChangesetColumn";
import { SectionCard } from "./shared/SectionCard";
export function ChangesetsSection({
  section
}: { section: BuildCompareChangesetsSectionViewModel }) {
  return (
    <SectionCard
      title="Changesets"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <ChangesetColumn title="Baseline build changes" items={section.baselineItems} />
        <ChangesetColumn title="Target build changes" items={section.targetItems} />
      </div>
    </SectionCard>
  );
}

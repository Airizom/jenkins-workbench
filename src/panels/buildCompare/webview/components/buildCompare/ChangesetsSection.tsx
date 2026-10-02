import type { BuildCompareChangesetsSectionViewModel } from "../../../shared/BuildCompareContracts";
import { ChangesetColumn } from "./ChangesetColumn";
import { SectionCard, type SectionCardDisclosureProps } from "./shared/SectionCard";

export function ChangesetsSection({
  section,
  ...disclosure
}: {
  section: BuildCompareChangesetsSectionViewModel;
} & SectionCardDisclosureProps) {
  // With no changesets on either side the summary already says so; skip the
  // per-build columns instead of repeating the same empty message twice.
  const hasItems = section.baselineItems.length > 0 || section.targetItems.length > 0;
  return (
    <SectionCard
      title="Commits"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
      {...disclosure}
    >
      {hasItems ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <ChangesetColumn title="Baseline build" items={section.baselineItems} />
          <ChangesetColumn title="Target build" items={section.targetItems} />
        </div>
      ) : null}
    </SectionCard>
  );
}

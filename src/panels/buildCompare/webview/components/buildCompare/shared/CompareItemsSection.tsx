import type { ReactNode } from "react";
import type { CompareSectionStatus } from "../../../../shared/BuildCompareContracts";
import { CompareEmptyState } from "./CompareEmptyState";
import { SectionCard } from "./SectionCard";

function resolveEmptyLabel(status: CompareSectionStatus, emptyLabel: string): string | undefined {
  switch (status) {
    case "empty":
      return emptyLabel;
    case "loading":
      return "Comparison is loading.";
    case "error":
      return "Comparison failed.";
    case "unavailable":
      return "Comparison data is unavailable.";
    default:
      return undefined;
  }
}

type CompareItemsSectionProps<TItem> = {
  title: string;
  summary: string;
  detail?: string;
  status: CompareSectionStatus;
  items: TItem[];
  emptyLabel: string;
  renderItems: (items: TItem[]) => ReactNode;
};
export function CompareItemsSection<TItem>({
  title,
  summary,
  detail,
  status,
  items,
  emptyLabel,
  renderItems
}: CompareItemsSectionProps<TItem>): React.JSX.Element {
  const emptyStateLabel = resolveEmptyLabel(status, emptyLabel);

  return (
    <SectionCard title={title} summary={summary} detail={detail} status={status}>
      {items.length > 0 ? (
        renderItems(items)
      ) : emptyStateLabel ? (
        <CompareEmptyState label={emptyStateLabel} />
      ) : null}
    </SectionCard>
  );
}

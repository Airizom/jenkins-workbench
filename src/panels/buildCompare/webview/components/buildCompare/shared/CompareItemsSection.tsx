import type { ReactNode } from "react";
import type { CompareSectionStatus } from "../../../../shared/BuildCompareContracts";
import { SectionCard, type SectionCardDisclosureProps } from "./SectionCard";

type CompareItemsSectionProps<TItem> = {
  title: string;
  summary: string;
  detail?: string;
  status: CompareSectionStatus;
  items: TItem[];
  renderItems: (items: TItem[]) => ReactNode;
} & SectionCardDisclosureProps;

/**
 * A section listing changed items. Without items, the heading's summary and
 * detail already say why (no changes, no data, loading, or the error), so no
 * empty-state box is rendered.
 */
export function CompareItemsSection<TItem>({
  title,
  summary,
  detail,
  status,
  items,
  renderItems,
  ...disclosure
}: CompareItemsSectionProps<TItem>): React.JSX.Element {
  return (
    <SectionCard title={title} summary={summary} detail={detail} status={status} {...disclosure}>
      {items.length > 0 ? renderItems(items) : null}
    </SectionCard>
  );
}

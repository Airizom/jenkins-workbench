import type { ReactNode } from "react";
import * as React from "react";
import { EmptyState } from "./EmptyState";
import { SectionCard } from "./SectionCard";

const { Fragment } = React;

type CompareItemsSectionProps<TItem> = {
  title: string;
  summary: string;
  detail?: string;
  status: string;
  items: TItem[];
  emptyLabel: string;
  renderItem: (item: TItem) => ReactNode;
  itemKey: (item: TItem) => string;
};
export function CompareItemsSection<TItem>({
  title,
  summary,
  detail,
  status,
  items,
  emptyLabel,
  renderItem,
  itemKey
}: CompareItemsSectionProps<TItem>): JSX.Element {
  return (
    <SectionCard title={title} summary={summary} detail={detail} status={status}>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>
          ))}
        </div>
      ) : (
        <EmptyState label={emptyLabel} />
      )}
    </SectionCard>
  );
}

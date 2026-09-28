import type { BuildCompareChangesetItem } from "../../../shared/BuildCompareContracts";
import { CompareMutedCard } from "./shared/CompareMutedCard";
import { CompareSectionFrame } from "./shared/CompareSectionFrame";

export function ChangesetColumn({
  title,
  items
}: {
  title: string;
  items: BuildCompareChangesetItem[];
}) {
  if (items.length === 0) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">No commits</p>
      </div>
    );
  }
  return (
    <CompareSectionFrame title={title} count={items.length}>
      {items.map((item) => (
        <CompareMutedCard key={item.commitId ?? `${item.author}:${item.message}`}>
          <p className="text-sm [overflow-wrap:anywhere]">{item.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.author}
            {item.commitId ? ` · ${item.commitId}` : ""}
          </p>
        </CompareMutedCard>
      ))}
    </CompareSectionFrame>
  );
}

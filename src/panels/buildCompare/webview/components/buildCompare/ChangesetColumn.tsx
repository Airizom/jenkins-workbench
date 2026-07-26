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
  return (
    <CompareSectionFrame title={title} count={items.length} emptyLabel="No changesets recorded.">
      {items.map((item) => (
        <CompareMutedCard key={item.commitId ?? `${item.author}:${item.message}`}>
          <p className="text-sm">{item.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.author}
            {item.commitId ? ` • ${item.commitId}` : ""}
          </p>
        </CompareMutedCard>
      ))}
    </CompareSectionFrame>
  );
}

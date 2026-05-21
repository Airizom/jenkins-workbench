import type { BuildCompareChangesetItem } from "../../../shared/BuildCompareContracts";
import { CompareSectionFrame } from "./shared/CompareSectionFrame";

export function ChangesetColumn({
  title,
  items
}: { title: string; items: BuildCompareChangesetItem[] }) {
  return (
    <CompareSectionFrame title={title} count={items.length} emptyLabel="No changesets recorded.">
      {items.map((item, index) => (
        <div
          key={`${item.commitId ?? item.message}:${index}`}
          className="rounded-lg border border-border bg-muted-soft px-3 py-2"
        >
          <p className="text-sm">{item.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.author}
            {item.commitId ? ` • ${item.commitId}` : ""}
          </p>
        </div>
      ))}
    </CompareSectionFrame>
  );
}

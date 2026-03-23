import { GitCommitIcon, UserIcon } from "../../../../../shared/webview/icons";
import type { BuildFailureChangelogItem } from "../../../../shared/BuildDetailsContracts";
import { OverflowText } from "./BuildFailureOverflowText";

export function BuildFailureChangelogCard({
  items,
  overflowCount
}: {
  items: BuildFailureChangelogItem[];
  overflowCount: number;
}) {
  return (
    <div className="rounded border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <GitCommitIcon className="h-4 w-4 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Changelog
        </span>
      </div>
      {items.length > 0 ? (
        <ChangelogList items={items} />
      ) : (
        <div className="flex items-center justify-center rounded border border-dashed border-border bg-muted-soft px-2.5 py-3 text-xs text-muted-foreground">
          No changes detected
        </div>
      )}
      <OverflowText value={overflowCount} />
    </div>
  );
}

function ChangelogList({ items }: { items: BuildFailureChangelogItem[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
      {items.map((item, index) => (
        <li
          className="rounded border border-mutedBorder bg-muted-soft px-2.5 py-1.5"
          key={`${item.message}-${index}`}
        >
          <div className="text-xs text-foreground line-clamp-2">{item.message}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserIcon className="h-3.5 w-3.5" />
              {item.author}
            </span>
            {item.commitId ? (
              <span className="font-mono">{item.commitId.substring(0, 7)}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

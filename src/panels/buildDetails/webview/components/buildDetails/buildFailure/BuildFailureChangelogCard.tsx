import type { BuildFailureChangelogItem } from "../../../../shared/BuildDetailsContracts";
import { OverflowText } from "./BuildFailureOverflowText";

function GitCommitIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-muted-foreground shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="1.05" y1="12" x2="7" y2="12" />
      <line x1="17.01" y1="12" x2="22.96" y2="12" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

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
        <GitCommitIcon />
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
              <UserIcon />
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

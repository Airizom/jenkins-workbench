import { Card } from "../../../../../shared/webview/components/ui/card";
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
      className="h-3 w-3 text-muted-foreground"
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
    <Card className="shadow-widget">
      <div className="min-h-[120px] p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
            <GitCommitIcon />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Changelog
          </div>
        </div>
        {items.length > 0 ? (
          <ChangelogList items={items} />
        ) : (
          <div className="flex items-center justify-center rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No changes detected
          </div>
        )}
        <OverflowText value={overflowCount} />
      </div>
    </Card>
  );
}

function ChangelogList({ items }: { items: BuildFailureChangelogItem[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {items.map((item, index) => (
        <li
          className="rounded border border-border bg-muted-soft px-3 py-2"
          key={`${item.message}-${index}`}
        >
          <div className="text-sm font-medium text-foreground line-clamp-2">{item.message}</div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
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

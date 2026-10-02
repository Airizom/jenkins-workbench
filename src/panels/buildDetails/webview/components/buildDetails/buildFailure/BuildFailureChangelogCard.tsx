import * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { GitCommitIcon, UserIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildFailureChangelogItem } from "../../../../shared/BuildDetailsContracts";
import { BuildFailureInsightCard, BuildFailureInsightEmpty } from "./BuildFailureInsightCard";
import { OverflowText } from "./BuildFailureOverflowText";
import { createUniqueListKeys } from "./buildFailureListKeys";

const { useState } = React;
export function BuildFailureChangelogCard({
  items,
  overflowCount
}: {
  items: BuildFailureChangelogItem[];
  overflowCount: number;
}) {
  return (
    <BuildFailureInsightCard
      icon={<GitCommitIcon className="h-4 w-4 shrink-0" />}
      title="Changelog"
    >
      {items.length > 0 ? (
        <ChangelogList items={items} />
      ) : (
        <BuildFailureInsightEmpty>No changes detected</BuildFailureInsightEmpty>
      )}
      <OverflowText value={overflowCount} />
    </BuildFailureInsightCard>
  );
}

function ChangelogList({ items }: { items: BuildFailureChangelogItem[] }) {
  const keys = createUniqueListKeys(
    items,
    (item) => item.commitId ?? `${item.author}\u0000${item.message}`
  );
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
      {items.map((item, index) => (
        <ChangelogEntry item={item} key={keys[index]} />
      ))}
    </ul>
  );
}

// Messages longer than roughly two card lines (or with several lines) clamp
// with a toggle; shorter ones never need it.
const LONG_MESSAGE_CHARS = 120;

export function isLongChangelogMessage(message: string): boolean {
  return message.length > LONG_MESSAGE_CHARS || message.trim().includes("\n");
}

function ChangelogEntry({ item }: { item: BuildFailureChangelogItem }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = isLongChangelogMessage(item.message);
  return (
    <li className="rounded border border-mutedBorder bg-muted-soft px-2.5 py-1.5">
      <div
        className={cn(
          "text-xs text-foreground wrap-break-word whitespace-pre-line",
          !expanded && "line-clamp-2"
        )}
      >
        {item.message}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <UserIcon className="h-3.5 w-3.5" />
          {item.author}
        </span>
        {item.commitId ? (
          // Clipped to the short id, but selecting it copies the full commit id.
          <code
            className="inline-block max-w-[7ch] overflow-hidden whitespace-nowrap align-bottom font-mono select-all"
            title={item.commitId}
          >
            {item.commitId}
          </code>
        ) : null}
        {canExpand ? (
          <Button
            variant="link"
            size="sm"
            className="ml-auto h-auto p-0 text-caption"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

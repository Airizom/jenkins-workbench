import type { BuildFailureChangelogItem } from "../../../../shared/BuildDetailsContracts";
import { Card } from "../../ui/card";
import { OverflowText } from "./BuildFailureOverflowText";

export function BuildFailureChangelogCard({
  items,
  overflowCount,
}: {
  items: BuildFailureChangelogItem[];
  overflowCount: number;
}) {
  return (
    <Card className="bg-background">
      <div className="min-h-[120px] p-3 flex flex-col gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Changelog
        </div>
        {items.length > 0 ? (
          <ChangelogList items={items} />
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
            No changes detected.
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
      {items.map((item, index) => {
        const metaParts = [item.author];
        if (item.commitId) {
          metaParts.push(item.commitId);
        }
        return (
          <li className="flex flex-col gap-1" key={`${item.message}-${index}`}>
            <div className="text-[13px] font-semibold text-foreground">
              {item.message}
            </div>
            <div className="text-xs text-muted-foreground break-words">
              {metaParts.join(" • ")}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

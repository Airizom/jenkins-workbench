import type { BuildFailureFailedTest } from "../../../../shared/BuildDetailsContracts";
import { Card } from "../../ui/card";
import { OverflowText } from "./BuildFailureOverflowText";

export function BuildFailureFailedTestsCard({
  items,
  overflowCount,
  summaryLabel,
  emptyMessage,
}: {
  items: BuildFailureFailedTest[];
  overflowCount: number;
  summaryLabel: string;
  emptyMessage: string;
}) {
  return (
    <Card className="bg-background">
      <div className="min-h-[120px] p-3 flex flex-col gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Tests
        </div>
        <div id="test-summary" className="text-[13px] font-semibold">
          {summaryLabel}
        </div>
        {items.length > 0 ? (
          <FailedTestsList items={items} />
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
            {emptyMessage}
          </div>
        )}
        <OverflowText value={overflowCount} />
      </div>
    </Card>
  );
}

function FailedTestsList({ items }: { items: BuildFailureFailedTest[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-3">
      {items.map((item, index) => (
        <li className="flex flex-col gap-1" key={`${item.name}-${index}`}>
          <div className="text-[13px] font-semibold text-foreground">
            {item.name || "Unnamed test"}
          </div>
          {item.className ? (
            <div className="text-xs text-muted-foreground break-words">
              {item.className}
            </div>
          ) : null}
          {item.errorDetails ? (
            <div className="text-xs text-foreground whitespace-pre-wrap break-words">
              {item.errorDetails}
            </div>
          ) : null}
          {item.durationLabel ? (
            <div className="text-[11px] text-muted-foreground">
              Duration • {item.durationLabel}
            </div>
          ) : null}
          {item.errorStackTrace ? (
            <FailedTestDetail
              label="Stack trace"
              value={item.errorStackTrace}
            />
          ) : null}
          {item.stdout ? <FailedTestDetail label="Stdout" value={item.stdout} /> : null}
          {item.stderr ? <FailedTestDetail label="Stderr" value={item.stderr} /> : null}
        </li>
      ))}
    </ul>
  );
}

function FailedTestDetail({ label, value }: { label: string; value: string }) {
  return (
    <details className="rounded-lg border border-border bg-background/40 px-2 py-1.5">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background px-2 py-1 text-[11px] font-mono leading-5">
        {value}
      </pre>
    </details>
  );
}

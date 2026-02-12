import { Badge } from "../../../../../shared/webview/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import { ScrollArea } from "../../../../../shared/webview/components/ui/scroll-area";
import type { BuildFailureFailedTest } from "../../../../shared/BuildDetailsContracts";
import { OverflowText } from "./BuildFailureOverflowText";

function TestTubeIcon() {
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
      <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5h0c-1.4 0-2.5-1.1-2.5-2.5V2" />
      <path d="M8.5 2h7" />
      <path d="M14.5 16h-5" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-failure shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function ClockIcon() {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function BuildFailureFailedTestsCard({
  items,
  overflowCount,
  summaryLabel,
  emptyMessage
}: {
  items: BuildFailureFailedTest[];
  overflowCount: number;
  summaryLabel: string;
  emptyMessage: string;
}) {
  return (
    <div className="rounded border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TestTubeIcon />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tests
          </span>
        </div>
        <Badge variant="secondary" id="test-summary" className="text-[10px] px-1.5 py-0">
          {summaryLabel}
        </Badge>
      </div>
      {items.length > 0 ? (
        <FailedTestsList items={items} />
      ) : (
        <div className="flex items-center justify-center rounded border border-dashed border-border bg-muted-soft px-2.5 py-3 text-xs text-muted-foreground">
          {emptyMessage}
        </div>
      )}
      <OverflowText value={overflowCount} />
    </div>
  );
}

function FailedTestsList({ items }: { items: BuildFailureFailedTest[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
      {items.map((item, index) => (
        <li
          className="rounded border border-mutedBorder bg-muted-soft overflow-hidden"
          key={`${item.name}-${index}`}
        >
          <div className="px-2.5 py-1.5">
            <div className="flex items-start gap-1.5">
              <XCircleIcon />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground">
                  {item.name || "Unnamed test"}
                </div>
                {item.className ? (
                  <div className="text-[11px] text-muted-foreground truncate">{item.className}</div>
                ) : null}
              </div>
            </div>
            {item.errorDetails ? (
              <div className="mt-1.5 text-[11px] text-foreground bg-failure-surface border border-failure-border-subtle rounded px-2 py-1 whitespace-pre-wrap wrap-break-word max-h-20 overflow-auto">
                {item.errorDetails}
              </div>
            ) : null}
            {item.durationLabel ? (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <ClockIcon />
                {item.durationLabel}
              </div>
            ) : null}
          </div>
          {item.errorStackTrace || item.stdout || item.stderr ? (
            <div className="border-t border-border px-2.5 py-1.5 space-y-1.5">
              {item.errorStackTrace ? (
                <FailedTestDetail label="Stack trace" value={item.errorStackTrace} />
              ) : null}
              {item.stdout ? <FailedTestDetail label="Stdout" value={item.stdout} /> : null}
              {item.stderr ? <FailedTestDetail label="Stderr" value={item.stderr} /> : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function FailedTestDetail({ label, value }: { label: string; value: string }) {
  return (
    <Collapsible className="overflow-hidden rounded border border-mutedBorder bg-muted-soft transition-colors data-[state=open]:border-border data-[state=open]:bg-muted-strong">
      <CollapsibleTrigger className="w-full px-2.5 py-1.5 hover:bg-accent-soft">
        <span className="text-[11px] font-medium text-muted-foreground group-data-[state=open]:text-foreground">
          {label}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-2.5 pb-1.5 pt-1.5">
        <ScrollArea className="max-h-40 rounded border border-border bg-background">
          <pre className="m-0 px-2 py-1 text-[11px] font-mono leading-relaxed whitespace-pre-wrap wrap-break-word">
            {value}
          </pre>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

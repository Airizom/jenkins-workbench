import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { Card } from "../../../../../shared/webview/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
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
      className="h-3 w-3 text-muted-foreground"
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
    <Card className="shadow-widget">
      <div className="min-h-[120px] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
              <TestTubeIcon />
            </div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tests
            </div>
          </div>
          <Badge variant="secondary" id="test-summary" className="text-xs">
            {summaryLabel}
          </Badge>
        </div>
        {items.length > 0 ? (
          <FailedTestsList items={items} />
        ) : (
          <div className="flex items-center justify-center rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
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
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {items.map((item, index) => (
        <li
          className="rounded border border-border bg-muted-soft overflow-hidden"
          key={`${item.name}-${index}`}
        >
          <div className="px-3 py-2">
            <div className="flex items-start gap-2">
              <XCircleIcon />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {item.name || "Unnamed test"}
                </div>
                {item.className ? (
                  <div className="text-xs text-muted-foreground truncate">{item.className}</div>
                ) : null}
              </div>
            </div>
            {item.errorDetails ? (
              <div className="mt-2 text-xs text-foreground bg-failure-surface border border-failure-border-subtle rounded px-2 py-1.5 whitespace-pre-wrap break-words max-h-24 overflow-auto">
                {item.errorDetails}
              </div>
            ) : null}
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              {item.durationLabel ? (
                <span className="inline-flex items-center gap-1">
                  <ClockIcon />
                  {item.durationLabel}
                </span>
              ) : null}
            </div>
          </div>
          {item.errorStackTrace || item.stdout || item.stderr ? (
            <div className="border-t border-border px-3 py-2 space-y-2">
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
    <Collapsible>
      <CollapsibleTrigger className="w-full rounded border border-border bg-muted-strong px-2 py-1.5 hover:bg-muted transition-colors">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-2 py-1.5 text-xs font-mono leading-relaxed">
          {value}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

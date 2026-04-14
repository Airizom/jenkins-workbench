import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { CheckCircleIcon, TestTubeIcon, XCircleIcon } from "../../../../../shared/webview/icons";

export function BuildFailureTestsSummaryCard({
  summaryLabel,
  hint
}: {
  summaryLabel: string;
  hint?: string;
}) {
  const hasFailed = /fail/i.test(summaryLabel) && !/Failed 0\b/.test(summaryLabel);

  return (
    <div className="rounded border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TestTubeIcon className="h-4 w-4 shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tests
          </span>
        </div>
        <Badge
          variant="outline"
          className={
            hasFailed
              ? "text-[10px] px-1.5 py-0 border-failure-border-subtle text-failure"
              : "text-[10px] px-1.5 py-0"
          }
        >
          {summaryLabel}
        </Badge>
      </div>
      <div className="rounded border border-dashed border-border bg-muted-soft px-2.5 py-3 flex items-start gap-2 text-xs text-muted-foreground">
        {hasFailed ? (
          <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-failure" />
        ) : hint ? (
          <CheckCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        ) : null}
        <span>{hint ?? "Detailed case results are available in the Test Results tab."}</span>
      </div>
    </div>
  );
}

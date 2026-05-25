import { TestStatusIcon } from "../../../../../shared/webview/components/TestStatusIcon";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import { BuildFailureInsightCard } from "./BuildFailureInsightCard";

export function BuildFailureTestsSummaryCard({
  summaryLabel,
  hasFailedTests,
  hint
}: {
  summaryLabel: string;
  hasFailedTests: boolean;
  hint?: string;
}) {
  return (
    <BuildFailureInsightCard
      icon={<TestTubeIcon className="h-4 w-4 shrink-0" />}
      title="Tests"
      headerExtra={<ToneBadge label={summaryLabel} tone={hasFailedTests ? "failed" : undefined} />}
    >
      <div className="rounded border border-dashed border-border bg-muted-soft px-2.5 py-3 flex items-start gap-2 text-xs text-muted-foreground">
        {hasFailedTests || hint ? (
          <TestStatusIcon
            status={hasFailedTests ? "failed" : "passed"}
            size={14}
            className="mt-0.5"
          />
        ) : null}
        <span>{hint ?? "Detailed case results are available in the Test Results tab."}</span>
      </div>
    </BuildFailureInsightCard>
  );
}

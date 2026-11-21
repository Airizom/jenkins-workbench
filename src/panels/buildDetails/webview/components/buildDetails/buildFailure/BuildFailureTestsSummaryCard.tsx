import { TestStatusIcon } from "../../../../../shared/webview/components/TestStatusIcon";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import { BuildFailureInsightCard, BuildFailureInsightEmpty } from "./BuildFailureInsightCard";
import { describeTestsSummaryHint } from "./testsSummaryHint";

export function BuildFailureTestsSummaryCard({
  summaryLabel,
  hasFailedTests,
  hint,
  hasTestsTab = true,
  reportUnavailable = false
}: {
  summaryLabel: string;
  hasFailedTests: boolean;
  hint?: string;
  hasTestsTab?: boolean;
  reportUnavailable?: boolean;
}) {
  const message = describeTestsSummaryHint({ hint, hasTestsTab, reportUnavailable });
  const showStatusIcon = hasFailedTests || (Boolean(hint) && hasTestsTab && !reportUnavailable);
  return (
    <BuildFailureInsightCard
      icon={<TestTubeIcon className="h-4 w-4 shrink-0" />}
      title="Tests"
      headerExtra={<ToneBadge label={summaryLabel} tone={hasFailedTests ? "failed" : undefined} />}
    >
      <BuildFailureInsightEmpty className="items-start justify-start gap-2">
        {showStatusIcon ? (
          <TestStatusIcon
            status={hasFailedTests ? "failed" : "passed"}
            size={14}
            className="mt-0.5"
          />
        ) : null}
        <span>{message}</span>
      </BuildFailureInsightEmpty>
    </BuildFailureInsightCard>
  );
}

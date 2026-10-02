import { TestStatusIcon } from "../../../../../shared/webview/components/TestStatusIcon";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { TestTubeIcon } from "../../../../../shared/webview/icons";
import { BuildFailureInsightCard } from "./BuildFailureInsightCard";

const TESTS_TAB_HINT = "Detailed case results are available in the Tests tab.";
const REPORT_UNAVAILABLE_MESSAGE =
  "The test report could not be loaded, so individual test results are unavailable.";
const NO_DETAILS_MESSAGE = "Individual test results are not available for this build.";

/**
 * Only points at the Tests tab when that tab exists, and says so plainly when
 * the report itself failed to load instead of promising results elsewhere.
 */
export function describeTestsSummaryHint({
  hint,
  hasTestsTab,
  reportUnavailable
}: {
  hint?: string;
  hasTestsTab: boolean;
  reportUnavailable: boolean;
}): string {
  if (reportUnavailable) {
    return REPORT_UNAVAILABLE_MESSAGE;
  }
  if (!hasTestsTab) {
    return NO_DETAILS_MESSAGE;
  }
  return hint ?? TESTS_TAB_HINT;
}

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
      <div className="rounded border border-dashed border-border bg-muted-soft px-2.5 py-3 flex items-start gap-2 text-xs text-muted-foreground">
        {showStatusIcon ? (
          <TestStatusIcon
            status={hasFailedTests ? "failed" : "passed"}
            size={14}
            className="mt-0.5"
          />
        ) : null}
        <span>{message}</span>
      </div>
    </BuildFailureInsightCard>
  );
}

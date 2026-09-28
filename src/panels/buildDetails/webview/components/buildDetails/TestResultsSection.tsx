import type * as React from "react";
import type {
  BuildDetailsCoverageStateViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel
} from "../../../shared/BuildDetailsContracts";
import { useTabsBarHeightVariable } from "../../hooks/useTabsBarHeightVariable";
import {
  CoverageSection,
  TestResultsEmptyState,
  TestResultsList,
  TestResultsSummaryCard,
  TestResultsToolbar,
  useTestResultsView
} from "./testResults";
export function TestResultsSection({
  buildUrl,
  summary,
  results,
  coverageState,
  onReloadWithLogs,
  onOpenSource
}: {
  buildUrl?: string;
  summary: BuildTestsSummaryViewModel;
  results: BuildTestResultsViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  onReloadWithLogs: () => void;
  onOpenSource: (testCase: BuildTestCaseViewModel) => void;
}) {
  const testResultsView = useTestResultsView({
    buildUrl,
    results,
    failedCount: summary.failedCount
  });
  useTabsBarHeightVariable();
  const emptyState = renderTestResultsEmptyState(
    results,
    summary,
    testResultsView.filteredItems.length
  );

  return (
    <section className="space-y-3">
      <TestResultsSummaryCard summary={summary} />

      <TestResultsToolbar
        summary={summary}
        results={results}
        statusFilter={testResultsView.statusFilter}
        query={testResultsView.query}
        onStatusFilterChange={testResultsView.setStatusFilter}
        onQueryChange={testResultsView.setQuery}
        onReloadWithLogs={onReloadWithLogs}
      />

      {results.loading && !emptyState ? (
        <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          />
          Loading test output…
        </div>
      ) : null}

      {emptyState ?? (
        <TestResultsList
          summary={summary}
          filteredItems={testResultsView.filteredItems}
          visibleItems={testResultsView.visibleItems}
          autoExpandIds={testResultsView.autoExpandIds}
          hasMore={testResultsView.hasMore}
          onShowMore={testResultsView.showMore}
          onOpenSource={onOpenSource}
        />
      )}

      <CoverageSection coverageState={coverageState} />
    </section>
  );
}

function renderTestResultsEmptyState(
  results: BuildTestResultsViewModel,
  summary: BuildTestsSummaryViewModel,
  filteredItemCount: number
): React.JSX.Element | undefined {
  // Keep showing existing results while a reload (for example loading test
  // output) is in flight; the placeholder is only for the first load.
  if (results.loading && results.items.length === 0) {
    return (
      <TestResultsEmptyState
        icon="loading"
        title="Loading detailed test results"
        message="Fetching Jenkins case-level data for this build."
      />
    );
  }

  if (summary.detailsUnavailable) {
    return (
      <TestResultsEmptyState
        icon="info"
        title="Detailed results unavailable"
        message="Jenkins reported test counts for this build, but case-level results are unavailable."
      />
    );
  }

  if (!summary.hasAnyResults) {
    return (
      <TestResultsEmptyState
        icon="empty"
        title="No test results"
        message="This build did not report any tests."
      />
    );
  }

  if (filteredItemCount === 0) {
    return (
      <TestResultsEmptyState
        icon="search"
        title="No matching tests"
        message="Adjust the status filter or search query to see more results."
      />
    );
  }

  return undefined;
}

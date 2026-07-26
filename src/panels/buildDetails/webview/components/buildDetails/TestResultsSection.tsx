import type * as React from "react";
import type {
  BuildDetailsCoverageStateViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel
} from "../../../shared/BuildDetailsContracts";
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
  const testResultsView = useTestResultsView({ buildUrl, results });
  const emptyState = renderTestResultsEmptyState(
    results,
    summary,
    testResultsView.filteredItems.length
  );

  return (
    <section className="space-y-3">
      <CoverageSection coverageState={coverageState} />

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
    </section>
  );
}

function renderTestResultsEmptyState(
  results: BuildTestResultsViewModel,
  summary: BuildTestsSummaryViewModel,
  filteredItemCount: number
): React.JSX.Element | undefined {
  if (results.loading) {
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

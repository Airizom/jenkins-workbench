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
  const testResultsView = useTestResultsView({ buildUrl, summary, results });

  return (
    <section className="space-y-3">
      <CoverageSection coverageState={coverageState} />

      <TestResultsSummaryCard summary={summary} passRate={testResultsView.passRate} />

      <TestResultsToolbar
        summary={summary}
        results={results}
        statusFilter={testResultsView.statusFilter}
        query={testResultsView.query}
        onStatusFilterChange={testResultsView.setStatusFilter}
        onQueryChange={testResultsView.setQuery}
        onReloadWithLogs={onReloadWithLogs}
      />

      {results.loading ? (
        <TestResultsEmptyState
          icon="loading"
          title="Loading detailed test results"
          message="Fetching Jenkins case-level data for this build."
        />
      ) : summary.detailsUnavailable ? (
        <TestResultsEmptyState
          icon="info"
          title="Detailed results unavailable"
          message="Jenkins reported test counts for this build, but case-level results are unavailable."
        />
      ) : !summary.hasAnyResults ? (
        <TestResultsEmptyState
          icon="empty"
          title="No test results"
          message="This build did not report any tests."
        />
      ) : testResultsView.filteredItems.length === 0 ? (
        <TestResultsEmptyState
          icon="search"
          title="No matching tests"
          message="Adjust the status filter or search query to see more results."
        />
      ) : (
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

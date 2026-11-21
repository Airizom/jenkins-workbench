import { EMPTY_TEST_RESULTS_LABEL } from "../../../../shared/TestReportFormatters";
import { isAnalysisBuildResult } from "../../../../shared/webview/lib/statusStyles";
import type {
  BuildDiagnosticsViewModel,
  BuildFailureInsightsViewModel
} from "../../../shared/BuildDetailsContracts";

export interface InsightsVisibility {
  hasChangelog: boolean;
  hasTests: boolean;
  hasArtifacts: boolean;
  testsCardInAnalysis: boolean;
  showAnalysis: boolean;
  showSummary: boolean;
}

function hasVisibleTestsSummary(
  insights: BuildFailureInsightsViewModel,
  showTestsSummary: boolean
): boolean {
  const hasTestsLabel =
    Boolean(insights.testSummaryLabel) && insights.testSummaryLabel !== EMPTY_TEST_RESULTS_LABEL;
  return hasTestsLabel && (showTestsSummary || Boolean(insights.testResultsHint));
}

export function resolveInsightsVisibility(
  resultClass: string,
  insights: BuildFailureInsightsViewModel,
  diagnostics: BuildDiagnosticsViewModel,
  showTestsSummary: boolean
): InsightsVisibility {
  const hasChangelog = insights.changelogItems.length > 0 || insights.changelogOverflow > 0;
  const hasTests = hasVisibleTestsSummary(insights, showTestsSummary);
  const hasArtifacts = insights.artifacts.length > 0 || insights.artifactsOverflow > 0;
  const testsCardInAnalysis = hasTests && insights.hasFailedTests;
  const showAnalysis =
    isAnalysisBuildResult(resultClass) || diagnostics.items.length > 0 || testsCardInAnalysis;
  const showSummary = hasChangelog || hasArtifacts || (hasTests && !testsCardInAnalysis);
  return { hasChangelog, hasTests, hasArtifacts, testsCardInAnalysis, showAnalysis, showSummary };
}

/** Whether the section renders anything; the overview uses it to avoid going blank. */
export function hasVisibleInsights(
  resultClass: string,
  insights: BuildFailureInsightsViewModel,
  diagnostics: BuildDiagnosticsViewModel,
  showTestsSummary: boolean
): boolean {
  const visibility = resolveInsightsVisibility(
    resultClass,
    insights,
    diagnostics,
    showTestsSummary
  );
  return visibility.showAnalysis || visibility.showSummary;
}

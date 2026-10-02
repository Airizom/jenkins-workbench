import type * as React from "react";
import { EMPTY_TEST_RESULTS_LABEL } from "../../../../shared/TestReportFormatters";
import { isAnalysisBuildResult } from "../../../../shared/webview/lib/statusStyles";
import type {
  ArtifactAction,
  BuildDiagnosticsViewModel,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel
} from "../../../shared/BuildDetailsContracts";
import { BuildFailureArtifactsCard } from "./buildFailure/BuildFailureArtifactsCard";
import { BuildFailureChangelogCard } from "./buildFailure/BuildFailureChangelogCard";
import { BuildFailureDiagnosticsCard } from "./buildFailure/BuildFailureDiagnosticsCard";
import { BuildFailureTestsSummaryCard } from "./buildFailure/BuildFailureTestsSummaryCard";

const FAILURE_ANALYSIS_TITLE = "Failure analysis";
const BUILD_SUMMARY_TITLE = "Build summary";

const INSIGHT_GRID_CLASS = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3";

function InsightsGroup({
  id,
  title,
  children
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className={INSIGHT_GRID_CLASS}>{children}</div>
    </section>
  );
}

interface InsightsVisibility {
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

function resolveInsightsVisibility(
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

function BuildSummaryGroup({
  insights,
  visibility,
  testsCard,
  onArtifactAction
}: {
  insights: BuildFailureInsightsViewModel;
  visibility: InsightsVisibility;
  testsCard: React.ReactNode;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
}): React.JSX.Element {
  return (
    <InsightsGroup id="build-details-build-summary" title={BUILD_SUMMARY_TITLE}>
      {visibility.hasChangelog ? (
        <BuildFailureChangelogCard
          items={insights.changelogItems}
          overflowCount={insights.changelogOverflow}
        />
      ) : null}
      {visibility.testsCardInAnalysis ? null : testsCard}
      {visibility.hasArtifacts ? (
        <BuildFailureArtifactsCard
          items={insights.artifacts}
          overflowCount={insights.artifactsOverflow}
          onArtifactAction={onArtifactAction}
        />
      ) : null}
    </InsightsGroup>
  );
}

type BuildFailureInsightsSectionProps = {
  resultClass?: string;
  insights: BuildFailureInsightsViewModel;
  diagnostics: BuildDiagnosticsViewModel;
  /** False when the overview already renders a test summary card above. */
  showTestsSummary: boolean;
  /** Whether a Tests tab exists for the tests card to point at. */
  hasTestsTab?: boolean;
  /** Jenkins reported counts but the case-level test report could not be loaded. */
  testReportUnavailable?: boolean;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
  onOpenDiagnosticSource: (targetId: string) => void;
  onShowDiagnosticProblems: () => void;
  onConfigureBuildDiagnostics: () => void;
};

/**
 * Splits overview insights into a "Failure analysis" group (diagnostics, plus the failed
 * test summary when no richer test card is shown) that only appears when there is
 * something to analyze, and a stable "Build summary" group for changelog and artifacts.
 */
export function BuildFailureInsightsSection({
  resultClass = "neutral",
  insights,
  diagnostics,
  showTestsSummary,
  hasTestsTab = true,
  testReportUnavailable = false,
  onArtifactAction,
  onOpenDiagnosticSource,
  onShowDiagnosticProblems,
  onConfigureBuildDiagnostics
}: BuildFailureInsightsSectionProps): React.JSX.Element | null {
  const visibility = resolveInsightsVisibility(
    resultClass,
    insights,
    diagnostics,
    showTestsSummary
  );

  if (!visibility.showAnalysis && !visibility.showSummary) {
    return null;
  }

  const testsCard = visibility.hasTests ? (
    <BuildFailureTestsSummaryCard
      summaryLabel={insights.testSummaryLabel}
      hasFailedTests={insights.hasFailedTests}
      hint={insights.testResultsHint}
      hasTestsTab={hasTestsTab}
      reportUnavailable={testReportUnavailable}
    />
  ) : null;

  return (
    <div className="space-y-3">
      {visibility.showAnalysis ? (
        <InsightsGroup id="build-details-failure-analysis" title={FAILURE_ANALYSIS_TITLE}>
          <BuildFailureDiagnosticsCard
            diagnostics={diagnostics}
            onOpenSource={onOpenDiagnosticSource}
            onShowProblems={onShowDiagnosticProblems}
            onConfigure={onConfigureBuildDiagnostics}
          />
          {visibility.testsCardInAnalysis ? testsCard : null}
        </InsightsGroup>
      ) : null}
      {visibility.showSummary ? (
        <BuildSummaryGroup
          insights={insights}
          visibility={visibility}
          testsCard={testsCard}
          onArtifactAction={onArtifactAction}
        />
      ) : null}
    </div>
  );
}

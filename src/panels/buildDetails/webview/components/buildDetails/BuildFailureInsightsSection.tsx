import type * as React from "react";
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
import {
  type InsightsVisibility,
  resolveInsightsVisibility
} from "./buildFailureInsightsVisibility";

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

function BuildSummaryGroup({
  insights,
  visibility,
  testsCard,
  onDownloadAllArtifacts,
  onArtifactAction
}: {
  insights: BuildFailureInsightsViewModel;
  visibility: InsightsVisibility;
  testsCard: React.ReactNode;
  onDownloadAllArtifacts: () => void;
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
          onDownloadAllArtifacts={onDownloadAllArtifacts}
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
  onDownloadAllArtifacts: () => void;
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
  onDownloadAllArtifacts,
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
          onDownloadAllArtifacts={onDownloadAllArtifacts}
          onArtifactAction={onArtifactAction}
        />
      ) : null}
    </div>
  );
}

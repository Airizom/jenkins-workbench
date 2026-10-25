import type * as React from "react";
import type {
  ArtifactAction,
  BuildDetailsCoverageStateViewModel,
  BuildDiagnosticsViewModel,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel,
  BuildTestsSummaryViewModel,
  PipelineStageViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { BuildDetailsTab } from "../../../hooks/useBuildDetailsTabs";
import { BuildFailureInsightsSection, hasVisibleInsights } from "../BuildFailureInsightsSection";
import { CoverageGlanceCard } from "./CoverageGlanceCard";
import { OverviewSummaryCard } from "./OverviewSummaryCard";
import { RelatedBuildsSection, type RelatedBuildsSectionProps } from "./RelatedBuildsSection";
import { RunningProgressCard } from "./RunningProgressCard";
import { TestPassDonutCard } from "./TestPassDonutCard";

type OverviewTabProps = {
  relatedBuilds?: RelatedBuildsSectionProps;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  hasPipelineStages: boolean;
  pipelineStages: PipelineStageViewModel[];
  consoleText: string;
  testsSummary: BuildTestsSummaryViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  diagnostics: BuildDiagnosticsViewModel;
  hasTests: boolean;
  onNavigateTab: (tab: BuildDetailsTab) => void;
  onDownloadAllArtifacts: () => void;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
  onOpenDiagnosticSource: (targetId: string) => void;
  onShowDiagnosticProblems: () => void;
  onConfigureBuildDiagnostics: () => void;
};
export function OverviewTab({
  relatedBuilds,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  hasPipelineStages,
  pipelineStages,
  consoleText,
  testsSummary,
  coverageState,
  insights,
  diagnostics,
  hasTests,
  onNavigateTab,
  onDownloadAllArtifacts,
  onArtifactAction,
  onOpenDiagnosticSource,
  onShowDiagnosticProblems,
  onConfigureBuildDiagnostics
}: OverviewTabProps): React.JSX.Element {
  const isRunning = resultClass === "running";
  const showTestsCard = hasTests && testsSummary.hasAnyResults;
  // Coverage is only fetched once a build completes, so a running build would
  // only ever show a placeholder here.
  const showCoverageCard = !isRunning && coverageState.status !== "disabled";
  const showInsights = hasVisibleInsights(resultClass, insights, diagnostics, !showTestsCard);

  return (
    <div className="space-y-3">
      {relatedBuilds ? <RelatedBuildsSection {...relatedBuilds} /> : null}
      {isRunning ? (
        <RunningProgressCard
          pipelineStages={pipelineStages}
          consoleText={consoleText}
          hasPipelineStages={hasPipelineStages}
          onNavigateTab={onNavigateTab}
        />
      ) : null}
      {showTestsCard || showCoverageCard ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {showTestsCard ? (
            <TestPassDonutCard summary={testsSummary} onShowTests={() => onNavigateTab("tests")} />
          ) : null}
          {showCoverageCard ? (
            <CoverageGlanceCard
              coverageState={coverageState}
              onShowTests={hasTests ? () => onNavigateTab("tests") : undefined}
            />
          ) : null}
        </div>
      ) : null}
      {showInsights ? (
        <BuildFailureInsightsSection
          resultClass={resultClass}
          insights={insights}
          diagnostics={diagnostics}
          showTestsSummary={!showTestsCard}
          hasTestsTab={hasTests}
          testReportUnavailable={testsSummary.detailsUnavailable}
          onDownloadAllArtifacts={onDownloadAllArtifacts}
          onArtifactAction={onArtifactAction}
          onOpenDiagnosticSource={onOpenDiagnosticSource}
          onShowDiagnosticProblems={onShowDiagnosticProblems}
          onConfigureBuildDiagnostics={onConfigureBuildDiagnostics}
        />
      ) : null}
      {!isRunning && !showTestsCard && !showCoverageCard && !showInsights ? (
        <OverviewSummaryCard
          resultLabel={resultLabel}
          resultClass={resultClass}
          durationLabel={durationLabel}
          timestampLabel={timestampLabel}
          hasPipelineStages={hasPipelineStages}
          onNavigateTab={onNavigateTab}
        />
      ) : null}
    </div>
  );
}

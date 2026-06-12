import { isAnalysisBuildResult } from "../../../../../shared/webview/lib/statusStyles";
import type {
  ArtifactAction,
  BuildDetailsCoverageStateViewModel,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { BuildDetailsTab } from "../../../hooks/useBuildDetailsTabs";
import { BuildFailureInsightsSection } from "../BuildFailureInsightsSection";
import { CoverageGlanceCard } from "./CoverageGlanceCard";
import { StatusSummaryCard } from "./StatusSummaryCard";
import { TestPassDonutCard } from "./TestPassDonutCard";

type OverviewTabProps = {
  displayName: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  testsSummary: BuildTestsSummaryViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  hasPipelineStages: boolean;
  hasTests: boolean;
  onNavigateTab: (tab: BuildDetailsTab) => void;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
};
export function OverviewTab({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel,
  testsSummary,
  coverageState,
  insights,
  hasPipelineStages,
  hasTests,
  onNavigateTab,
  onArtifactAction
}: OverviewTabProps): JSX.Element {
  const showTestsCard = hasTests && testsSummary.hasAnyResults;
  const insightsTitle = isAnalysisBuildResult(resultClass) ? "Failure Analysis" : "Build Summary";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <StatusSummaryCard
          displayName={displayName}
          resultLabel={resultLabel}
          resultClass={resultClass}
          durationLabel={durationLabel}
          timestampLabel={timestampLabel}
          culpritsLabel={culpritsLabel}
          hasPipelineStages={hasPipelineStages}
          hasTests={hasTests}
          onNavigateTab={onNavigateTab}
        />
        {showTestsCard ? (
          <TestPassDonutCard summary={testsSummary} onShowTests={() => onNavigateTab("tests")} />
        ) : null}
      </div>
      <CoverageGlanceCard
        coverageState={coverageState}
        onShowTests={hasTests ? () => onNavigateTab("tests") : undefined}
      />
      <section aria-label={insightsTitle} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {insightsTitle}
        </h2>
        <BuildFailureInsightsSection
          insights={insights}
          resultClass={resultClass}
          onArtifactAction={onArtifactAction}
        />
      </section>
    </div>
  );
}

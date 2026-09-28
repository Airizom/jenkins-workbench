import type * as React from "react";
import type {
  ArtifactAction,
  BuildDetailsCoverageStateViewModel,
  BuildDiagnosticsViewModel,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { BuildDetailsTab } from "../../../hooks/useBuildDetailsTabs";
import { BuildFailureInsightsSection } from "../BuildFailureInsightsSection";
import { CoverageGlanceCard } from "./CoverageGlanceCard";
import { TestPassDonutCard } from "./TestPassDonutCard";

type OverviewTabProps = {
  resultClass: string;
  testsSummary: BuildTestsSummaryViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  diagnostics: BuildDiagnosticsViewModel;
  hasTests: boolean;
  onNavigateTab: (tab: BuildDetailsTab) => void;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
  onOpenDiagnosticSource: (targetId: string) => void;
  onShowDiagnosticProblems: () => void;
  onConfigureBuildDiagnostics: () => void;
};
export function OverviewTab({
  resultClass,
  testsSummary,
  coverageState,
  insights,
  diagnostics,
  hasTests,
  onNavigateTab,
  onArtifactAction,
  onOpenDiagnosticSource,
  onShowDiagnosticProblems,
  onConfigureBuildDiagnostics
}: OverviewTabProps): React.JSX.Element {
  const showTestsCard = hasTests && testsSummary.hasAnyResults;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {showTestsCard ? (
          <TestPassDonutCard summary={testsSummary} onShowTests={() => onNavigateTab("tests")} />
        ) : null}
        <CoverageGlanceCard
          coverageState={coverageState}
          isRunning={resultClass === "running"}
          onShowTests={hasTests ? () => onNavigateTab("tests") : undefined}
        />
      </div>
      <BuildFailureInsightsSection
        resultClass={resultClass}
        insights={insights}
        diagnostics={diagnostics}
        showTestsSummary={!showTestsCard}
        onArtifactAction={onArtifactAction}
        onOpenDiagnosticSource={onOpenDiagnosticSource}
        onShowDiagnosticProblems={onShowDiagnosticProblems}
        onConfigureBuildDiagnostics={onConfigureBuildDiagnostics}
      />
    </div>
  );
}

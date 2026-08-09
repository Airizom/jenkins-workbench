import { EMPTY_TEST_RESULTS_LABEL } from "../../../../shared/TestReportFormatters";
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
export function BuildFailureInsightsSection({
  insights,
  diagnostics,
  onArtifactAction,
  onOpenDiagnosticSource,
  onShowDiagnosticProblems,
  onConfigureBuildDiagnostics
}: {
  insights: BuildFailureInsightsViewModel;
  diagnostics: BuildDiagnosticsViewModel;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
  onOpenDiagnosticSource: (targetId: string) => void;
  onShowDiagnosticProblems: () => void;
  onConfigureBuildDiagnostics: () => void;
}) {
  const hasChangelog = insights.changelogItems.length > 0 || insights.changelogOverflow > 0;
  const hasTests =
    Boolean(insights.testSummaryLabel) && insights.testSummaryLabel !== EMPTY_TEST_RESULTS_LABEL;
  const hasArtifacts = insights.artifacts.length > 0 || insights.artifactsOverflow > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <BuildFailureDiagnosticsCard
        diagnostics={diagnostics}
        onOpenSource={onOpenDiagnosticSource}
        onShowProblems={onShowDiagnosticProblems}
        onConfigure={onConfigureBuildDiagnostics}
      />
      {hasChangelog ? (
        <BuildFailureChangelogCard
          items={insights.changelogItems}
          overflowCount={insights.changelogOverflow}
        />
      ) : null}
      {hasTests ? (
        <BuildFailureTestsSummaryCard
          summaryLabel={insights.testSummaryLabel}
          hasFailedTests={insights.hasFailedTests}
          hint={insights.testResultsHint}
        />
      ) : null}
      {hasArtifacts ? (
        <BuildFailureArtifactsCard
          items={insights.artifacts}
          overflowCount={insights.artifactsOverflow}
          onArtifactAction={onArtifactAction}
        />
      ) : null}
    </div>
  );
}

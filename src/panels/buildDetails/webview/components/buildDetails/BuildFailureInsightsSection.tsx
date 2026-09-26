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
  showTestsSummary,
  onArtifactAction,
  onOpenDiagnosticSource,
  onShowDiagnosticProblems,
  onConfigureBuildDiagnostics
}: {
  insights: BuildFailureInsightsViewModel;
  diagnostics: BuildDiagnosticsViewModel;
  /** False when the overview already renders a test summary card above. */
  showTestsSummary: boolean;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
  onOpenDiagnosticSource: (targetId: string) => void;
  onShowDiagnosticProblems: () => void;
  onConfigureBuildDiagnostics: () => void;
}) {
  const hasChangelog = insights.changelogItems.length > 0 || insights.changelogOverflow > 0;
  const hasTestsLabel =
    Boolean(insights.testSummaryLabel) && insights.testSummaryLabel !== EMPTY_TEST_RESULTS_LABEL;
  const hasTests = hasTestsLabel && (showTestsSummary || Boolean(insights.testResultsHint));
  const hasArtifacts = insights.artifacts.length > 0 || insights.artifactsOverflow > 0;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
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

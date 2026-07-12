import { EMPTY_TEST_RESULTS_LABEL } from "../../../../shared/TestReportConstants";
import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel
} from "../../../shared/BuildDetailsContracts";
import { BuildFailureArtifactsCard } from "./buildFailure/BuildFailureArtifactsCard";
import { BuildFailureChangelogCard } from "./buildFailure/BuildFailureChangelogCard";
import { BuildFailureEmptyStateCard } from "./buildFailure/BuildFailureEmptyStateCard";
import { BuildFailureTestsSummaryCard } from "./buildFailure/BuildFailureTestsSummaryCard";
export function BuildFailureInsightsSection({
  insights,
  onArtifactAction
}: {
  insights: BuildFailureInsightsViewModel;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
}) {
  const hasChangelog = insights.changelogItems.length > 0 || insights.changelogOverflow > 0;
  const hasTests =
    Boolean(insights.testSummaryLabel) && insights.testSummaryLabel !== EMPTY_TEST_RESULTS_LABEL;
  const hasArtifacts = insights.artifacts.length > 0 || insights.artifactsOverflow > 0;
  const hasInsights = hasChangelog || hasTests || hasArtifacts;

  if (!hasInsights) {
    // The overview heading already names this section; keep the card body-only.
    return <BuildFailureEmptyStateCard />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <BuildFailureChangelogCard
        items={insights.changelogItems}
        overflowCount={insights.changelogOverflow}
      />
      <BuildFailureTestsSummaryCard
        summaryLabel={insights.testSummaryLabel}
        hasFailedTests={insights.hasFailedTests}
        hint={insights.testResultsHint}
      />
      <BuildFailureArtifactsCard
        items={insights.artifacts}
        overflowCount={insights.artifactsOverflow}
        onArtifactAction={onArtifactAction}
      />
    </div>
  );
}

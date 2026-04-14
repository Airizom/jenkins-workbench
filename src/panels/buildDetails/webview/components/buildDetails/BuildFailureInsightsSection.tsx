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
  resultClass,
  onArtifactAction
}: {
  insights: BuildFailureInsightsViewModel;
  resultClass: string;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
}) {
  const isFailure = resultClass === "failure" || resultClass === "unstable";
  const sectionTitle = isFailure ? "Failure Analysis" : "Build Summary";
  const hasChangelog = insights.changelogItems.length > 0 || insights.changelogOverflow > 0;
  const hasTests =
    Boolean(insights.testSummaryLabel) && insights.testSummaryLabel !== "No test results.";
  const hasArtifacts = insights.artifacts.length > 0 || insights.artifactsOverflow > 0;
  const hasInsights = hasChangelog || hasTests || hasArtifacts;

  if (!hasInsights) {
    return <BuildFailureEmptyStateCard title={sectionTitle} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <BuildFailureChangelogCard
        items={insights.changelogItems}
        overflowCount={insights.changelogOverflow}
      />
      <BuildFailureTestsSummaryCard
        summaryLabel={insights.testSummaryLabel}
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

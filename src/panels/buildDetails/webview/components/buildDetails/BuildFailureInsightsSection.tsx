import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel
} from "../../../shared/BuildDetailsContracts";
import { BuildFailureArtifactsCard } from "./buildFailure/BuildFailureArtifactsCard";
import { BuildFailureChangelogCard } from "./buildFailure/BuildFailureChangelogCard";
import { BuildFailureEmptyStateCard } from "./buildFailure/BuildFailureEmptyStateCard";
import { BuildFailureFailedTestsCard } from "./buildFailure/BuildFailureFailedTestsCard";

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
  const hasFailedTests = insights.failedTests.length > 0 || insights.failedTestsOverflow > 0;
  const hasArtifacts = insights.artifacts.length > 0 || insights.artifactsOverflow > 0;
  const hasInsights = hasChangelog || hasFailedTests || hasArtifacts;

  if (!hasInsights) {
    return <BuildFailureEmptyStateCard title={sectionTitle} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <BuildFailureChangelogCard
        items={insights.changelogItems}
        overflowCount={insights.changelogOverflow}
      />
      <BuildFailureFailedTestsCard
        items={insights.failedTests}
        overflowCount={insights.failedTestsOverflow}
        summaryLabel={insights.testSummaryLabel}
        emptyMessage={insights.failedTestsMessage}
      />
      <BuildFailureArtifactsCard
        items={insights.artifacts}
        overflowCount={insights.artifactsOverflow}
        onArtifactAction={onArtifactAction}
      />
    </div>
  );
}

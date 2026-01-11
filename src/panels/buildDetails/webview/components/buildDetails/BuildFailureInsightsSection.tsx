import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel,
} from "../../../shared/BuildDetailsContracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { BuildFailureArtifactsCard } from "./buildFailure/BuildFailureArtifactsCard";
import { BuildFailureChangelogCard } from "./buildFailure/BuildFailureChangelogCard";
import { BuildFailureEmptyStateCard } from "./buildFailure/BuildFailureEmptyStateCard";
import { BuildFailureFailedTestsCard } from "./buildFailure/BuildFailureFailedTestsCard";

export function BuildFailureInsightsSection({
  insights,
  resultClass,
  onArtifactAction,
}: {
  insights: BuildFailureInsightsViewModel;
  resultClass: string;
  onArtifactAction: (
    action: ArtifactAction,
    artifact: BuildFailureArtifact
  ) => void;
}) {
  const isFailure = resultClass === "failure" || resultClass === "unstable";
  const sectionTitle = isFailure ? "Failure Analysis" : "Build Summary";
  const hasChangelog =
    insights.changelogItems.length > 0 || insights.changelogOverflow > 0;
  const hasFailedTests =
    insights.failedTests.length > 0 || insights.failedTestsOverflow > 0;
  const hasArtifacts =
    insights.artifacts.length > 0 || insights.artifactsOverflow > 0;
  const hasInsights = hasChangelog || hasFailedTests || hasArtifacts;

  if (!hasInsights) {
    return <BuildFailureEmptyStateCard title={sectionTitle} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{sectionTitle}</CardTitle>
        <CardDescription>
          Changelog, test summary, and artifacts for this build.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
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
      </CardContent>
    </Card>
  );
}

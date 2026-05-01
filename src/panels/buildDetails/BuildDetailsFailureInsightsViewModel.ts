import type { JenkinsBuildDetails } from "../../jenkins/types";
import type {
  BuildFailureArtifact,
  BuildFailureChangelogItem,
  BuildFailureInsightsViewModel,
  BuildTestsSummaryViewModel
} from "./shared/BuildDetailsContracts";

const INSIGHTS_LIST_LIMIT = 20;

export function buildBuildFailureInsights(
  details?: JenkinsBuildDetails,
  testsSummary?: BuildTestsSummaryViewModel
): BuildFailureInsightsViewModel {
  const changelogItems = buildChangelog(details);
  const cappedChangelog = capList(changelogItems, INSIGHTS_LIST_LIMIT);

  const artifacts = buildArtifacts(details);
  const cappedArtifacts = capList(artifacts, INSIGHTS_LIST_LIMIT);

  return {
    changelogItems: cappedChangelog.items,
    changelogOverflow: cappedChangelog.overflow,
    testSummaryLabel: testsSummary?.summaryLabel ?? "No test results.",
    testResultsHint: testsSummary?.hasDetailedResults
      ? "Browse detailed results in the Test Results tab."
      : undefined,
    artifacts: cappedArtifacts.items,
    artifactsOverflow: cappedArtifacts.overflow
  };
}

function buildChangelog(details?: JenkinsBuildDetails): BuildFailureChangelogItem[] {
  if (!details) {
    return [];
  }
  const items: NonNullable<NonNullable<JenkinsBuildDetails["changeSet"]>["items"]> = [];
  if (details.changeSet?.items) {
    items.push(...details.changeSet.items);
  }
  if (details.changeSets) {
    for (const changeSet of details.changeSets) {
      if (changeSet.items) {
        items.push(...changeSet.items);
      }
    }
  }

  const seen = new Set<string>();
  const results: BuildFailureChangelogItem[] = [];

  for (const item of items) {
    const message = (item.msg ?? "").trim();
    const author = (item.author?.fullName ?? "").trim();
    const commitId = item.commitId?.trim();
    const key = commitId ? `id:${commitId}` : `${message}|${author}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({
      message: message || "Commit",
      author: author || "Unknown author",
      commitId
    });
  }

  return results;
}

function buildArtifacts(details?: JenkinsBuildDetails): BuildFailureArtifact[] {
  if (!details?.artifacts || details.artifacts.length === 0) {
    return [];
  }
  const items: BuildFailureArtifact[] = [];
  for (const artifact of details.artifacts) {
    const relativePath = (artifact.relativePath ?? "").trim();
    if (!relativePath) {
      continue;
    }
    const fileName = artifact.fileName?.trim();
    const name = fileName || relativePath || "Artifact";
    const entry: BuildFailureArtifact = {
      name,
      relativePath
    };
    if (fileName) {
      entry.fileName = fileName;
    }
    items.push(entry);
  }
  return items;
}

function capList<T>(items: T[], limit: number): { items: T[]; overflow: number } {
  if (items.length <= limit) {
    return { items, overflow: 0 };
  }
  return {
    items: items.slice(0, limit),
    overflow: Math.max(0, items.length - limit)
  };
}

import { collectBuildChangesets } from "../../jenkins/changesets/collectBuildChangesets";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { capListWithOverflow } from "../../shared/arrays";
import { EMPTY_TEST_RESULTS_LABEL } from "../shared/TestReportFormatters";
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
  const cappedChangelog = capListWithOverflow(changelogItems, INSIGHTS_LIST_LIMIT);

  const artifacts = buildArtifacts(details);
  const cappedArtifacts = capListWithOverflow(artifacts, INSIGHTS_LIST_LIMIT);

  return {
    changelogItems: cappedChangelog.items,
    changelogOverflow: cappedChangelog.overflow,
    testSummaryLabel: testsSummary?.summaryLabel ?? EMPTY_TEST_RESULTS_LABEL,
    hasFailedTests: (testsSummary?.failedCount ?? 0) > 0,
    testResultsHint: testsSummary?.hasDetailedResults
      ? "Browse detailed results in the Test Results tab."
      : undefined,
    artifacts: cappedArtifacts.items,
    artifactsOverflow: cappedArtifacts.overflow
  };
}

function buildChangelog(details?: JenkinsBuildDetails): BuildFailureChangelogItem[] {
  return collectBuildChangesets(details);
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

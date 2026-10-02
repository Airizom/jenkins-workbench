import { formatNumber } from "../../formatters/DisplayFormatters";
import { collectBuildChangesets } from "../../jenkins/changesets/collectBuildChangesets";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { BuildCompareChangesetsSectionViewModel } from "./shared/BuildCompareContracts";

export function buildChangesetsSection(
  baselineDetails: JenkinsBuildDetails,
  targetDetails: JenkinsBuildDetails
): BuildCompareChangesetsSectionViewModel {
  const baselineItems = collectBuildChangesets(baselineDetails);
  const targetItems = collectBuildChangesets(targetDetails);
  const hasItems = baselineItems.length > 0 || targetItems.length > 0;
  return {
    status: hasItems ? "available" : "empty",
    summaryLabel: hasItems
      ? `${formatCommitCount(baselineItems.length)} in baseline · ${formatCommitCount(targetItems.length)} in target`
      : "No commits recorded for either build",
    detail: hasItems
      ? "Jenkins records each build's commits since the build before it, not the full difference between these two builds."
      : undefined,
    baselineItems,
    targetItems
  };
}

function formatCommitCount(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "commit" : "commits"}`;
}

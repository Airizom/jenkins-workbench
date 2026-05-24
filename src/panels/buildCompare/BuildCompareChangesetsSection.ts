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
      ? `Baseline ${formatNumber(baselineItems.length)} • Target ${formatNumber(targetItems.length)}`
      : "No Jenkins changesets recorded for either build",
    detail: hasItems
      ? "Jenkins changesets are per-build, not the full SCM delta between arbitrary build numbers."
      : undefined,
    baselineItems,
    targetItems
  };
}

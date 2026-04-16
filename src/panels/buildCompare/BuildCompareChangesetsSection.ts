import type { JenkinsBuildDetails, JenkinsChangeSetItem } from "../../jenkins/types";
import { formatNumber } from "../buildDetails/BuildDetailsFormatters";
import { normalizeString } from "./BuildCompareSectionShared";
import type {
  BuildCompareChangesetItem,
  BuildCompareChangesetsSectionViewModel
} from "./shared/BuildCompareContracts";

export function buildChangesetsSection(
  baselineDetails: JenkinsBuildDetails,
  targetDetails: JenkinsBuildDetails
): BuildCompareChangesetsSectionViewModel {
  const baselineItems = buildChangesetItems(baselineDetails);
  const targetItems = buildChangesetItems(targetDetails);
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

function buildChangesetItems(details: JenkinsBuildDetails): BuildCompareChangesetItem[] {
  const allItems: JenkinsChangeSetItem[] = [];
  if (details.changeSet?.items) {
    allItems.push(...details.changeSet.items);
  }
  for (const changeSet of details.changeSets ?? []) {
    if (changeSet.items) {
      allItems.push(...changeSet.items);
    }
  }

  const seen = new Set<string>();
  const result: BuildCompareChangesetItem[] = [];
  for (const item of allItems) {
    const commitId = normalizeString(item.commitId);
    const message = normalizeString(item.msg) ?? "Commit";
    const author = normalizeString(item.author?.fullName) ?? "Unknown author";
    const key = commitId ? `id:${commitId}` : `${message}::${author}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ message, author, commitId });
  }
  return result;
}

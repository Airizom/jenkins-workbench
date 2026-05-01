import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import {
  ACTIVITY_GROUP_ORDER,
  type ActivityGroupKind,
  type ActivityJobViewModel,
  type ActivityViewModel
} from "../ActivityTypes";
import type { ActivityGroups } from "./ActivityCollectionModel";

export function buildActivityViewModel(groups: ActivityGroups, limit: number): ActivityViewModel {
  const groupViewModels = ACTIVITY_GROUP_ORDER.map((kind) => {
    const entries = groups.get(kind) ?? [];
    const displayedEntries = entries.slice(0, limit);
    return {
      kind,
      items: displayedEntries.map(({ entry, group }) => mapActivityJob(entry, group)),
      displayedCount: displayedEntries.length,
      isTruncated: entries.length > limit
    };
  }).filter((group) => group.displayedCount > 0);

  const summaryGroups = groupViewModels.map((group) => ({
    kind: group.kind,
    displayedCount: group.displayedCount,
    isTruncated: group.isTruncated
  }));

  return {
    groups: groupViewModels,
    summary: {
      displayedTotal: summaryGroups.reduce((sum, group) => sum + group.displayedCount, 0),
      limit,
      isTruncated: summaryGroups.some((group) => group.isTruncated),
      groups: summaryGroups
    }
  };
}

function mapActivityJob(entry: JobSearchEntry, group: ActivityGroupKind): ActivityJobViewModel {
  return {
    group,
    name: entry.name,
    url: entry.url,
    color: entry.color,
    kind: entry.kind,
    pathContext: formatActivityPathContext(entry)
  };
}

function formatActivityPathContext(entry: JobSearchEntry): string | undefined {
  const parents = entry.path
    .slice(0, -1)
    .map((part) => part.name)
    .filter(Boolean);
  if (parents.length > 0) {
    return parents.join(" / ");
  }
  const fullNameParts = entry.fullName.split("/").filter(Boolean);
  return fullNameParts.length > 1 ? fullNameParts.slice(0, -1).join(" / ") : undefined;
}

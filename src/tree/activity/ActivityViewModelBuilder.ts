import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import {
  ACTIVITY_GROUP_ORDER,
  type ActivityGroupKind,
  type ActivityJobViewModel,
  type ActivityViewModel
} from "../ActivityTypes";
import type { ActivityGroups } from "./ActivityCollectionModel";

export function buildActivityViewModel(groups: ActivityGroups, limit: number): ActivityViewModel {
  const groupViewModels: ActivityViewModel["groups"] = [];
  const summaryGroups: ActivityViewModel["summary"]["groups"] = [];
  let displayedTotal = 0;
  let isTruncated = false;

  for (const kind of ACTIVITY_GROUP_ORDER) {
    const entries = groups.get(kind) ?? [];
    const displayedEntries = entries.slice(0, limit);
    const displayedCount = displayedEntries.length;
    if (displayedCount === 0) {
      continue;
    }

    const groupIsTruncated = entries.length > limit;
    groupViewModels.push({
      kind,
      items: displayedEntries.map(({ entry, group }) => mapActivityJob(entry, group)),
      displayedCount,
      isTruncated: groupIsTruncated
    });
    summaryGroups.push({
      kind,
      displayedCount,
      isTruncated: groupIsTruncated
    });
    displayedTotal += displayedCount;
    isTruncated ||= groupIsTruncated;
  }

  return {
    groups: groupViewModels,
    summary: {
      displayedTotal,
      limit,
      isTruncated,
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
  const parents: string[] = [];
  for (let index = 0; index < entry.path.length - 1; index += 1) {
    const name = entry.path[index]?.name;
    if (name) {
      parents.push(name);
    }
  }
  if (parents.length > 0) {
    return parents.join(" / ");
  }
  const fullNameParts = entry.fullName.split("/").filter(Boolean);
  return fullNameParts.length > 1 ? fullNameParts.slice(0, -1).join(" / ") : undefined;
}

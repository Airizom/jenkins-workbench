import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import { decodeJenkinsJobName } from "../../jenkins/JenkinsJobNames";
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
    const displayedCount = Math.min(entries.length, limit);
    if (displayedCount === 0) {
      continue;
    }

    const groupIsTruncated = entries.length > limit;
    groupViewModels.push({
      kind,
      items: mapActivityJobs(entries, kind, displayedCount),
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

function mapActivityJobs(
  entries: JobSearchEntry[],
  group: ActivityGroupKind,
  count: number
): ActivityJobViewModel[] {
  const jobs: ActivityJobViewModel[] = [];
  for (let index = 0; index < count; index += 1) {
    jobs.push(mapActivityJob(entries[index], group));
  }
  return jobs;
}

function mapActivityJob(entry: JobSearchEntry, group: ActivityGroupKind): ActivityJobViewModel {
  return {
    group,
    // Multibranch jobs are named after the URL-encoded branch (feature%2Fx).
    name: decodeJenkinsJobName(entry.name),
    url: entry.url,
    color: entry.color,
    kind: entry.kind,
    pathContext: formatActivityPathContext(entry)
  };
}

function formatActivityPathContext(entry: JobSearchEntry): string | undefined {
  let pathParts: string[] | undefined;
  for (let index = 0; index < entry.path.length - 1; index += 1) {
    const name = entry.path[index]?.name;
    if (name) {
      pathParts ??= [];
      pathParts.push(name);
    }
  }
  if (pathParts) {
    return pathParts.join(" / ");
  }
  const fullNameParts = entry.fullName.split("/").filter(Boolean);
  return fullNameParts.length > 1 ? fullNameParts.slice(0, -1).join(" / ") : undefined;
}

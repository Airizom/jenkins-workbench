import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import type { ActivityGroupKind } from "../ActivityTypes";
import { ACTIVITY_GROUP_ORDER } from "../ActivityTypes";
import type { ActivityGroups } from "./ActivityCollectionModel";

export function createActivityGroups(): ActivityGroups {
  const groups = new Map<ActivityGroupKind, JobSearchEntry[]>();
  for (const group of ACTIVITY_GROUP_ORDER) {
    groups.set(group, []);
  }
  return groups;
}

export function promoteAwaitingInputJobs(
  groups: ActivityGroups,
  runningCandidates: JobSearchEntry[],
  awaitingInputJobUrls: ReadonlySet<string>,
  maxItems: number
): void {
  if (awaitingInputJobUrls.size === 0 || maxItems <= 0) {
    return;
  }

  const promotedJobUrls = promoteCandidatesToAwaitingInput(
    groups,
    runningCandidates,
    awaitingInputJobUrls,
    maxItems
  );
  if (promotedJobUrls.size === 0) {
    return;
  }

  removePromotedEntriesFromOtherGroups(groups, promotedJobUrls);
}

function promoteCandidatesToAwaitingInput(
  groups: ActivityGroups,
  runningCandidates: JobSearchEntry[],
  awaitingInputJobUrls: ReadonlySet<string>,
  maxItems: number
): Set<string> {
  const awaiting = groups.get("awaitingInput") ?? [];
  const promotedJobUrls = new Set<string>();
  for (const entry of runningCandidates) {
    if (awaiting.length >= maxItems) {
      break;
    }
    if (!awaitingInputJobUrls.has(entry.url)) {
      continue;
    }
    awaiting.push(entry);
    promotedJobUrls.add(entry.url);
  }
  groups.set("awaitingInput", awaiting);
  return promotedJobUrls;
}

function removePromotedEntriesFromOtherGroups(
  groups: ActivityGroups,
  promotedJobUrls: ReadonlySet<string>
): void {
  for (const group of ["failing", "unstable", "running"] as const) {
    const current = groups.get(group);
    if (!current) {
      continue;
    }
    const filtered = current.filter((entry) => !promotedJobUrls.has(entry.url));
    groups.set(group, filtered);
  }
}

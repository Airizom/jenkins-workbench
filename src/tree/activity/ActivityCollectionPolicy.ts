import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import { ACTIVITY_GROUP_ORDER } from "../ActivityTypes";
import type { ActivityGroupKind } from "../ActivityTypes";
import type { ActivityEntry, ActivityGroups } from "./ActivityCollectionModel";

export function createActivityGroups(): ActivityGroups {
  return new Map<ActivityGroupKind, ActivityEntry[]>(
    ACTIVITY_GROUP_ORDER.map((group) => [group, []])
  );
}

export function areActivityCollectionTargetsFull(
  groups: ActivityGroups,
  runningCandidateCount: number,
  collectionLimit: number,
  pendingInputCandidateLimit: number
): boolean {
  return (
    runningCandidateCount >= pendingInputCandidateLimit &&
    (groups.get("failing")?.length ?? 0) >= collectionLimit &&
    (groups.get("unstable")?.length ?? 0) >= collectionLimit &&
    (groups.get("running")?.length ?? 0) >= collectionLimit
  );
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

  const awaiting = groups.get("awaitingInput") ?? [];
  const promotedJobUrls = new Set<string>();
  for (const entry of runningCandidates) {
    if (awaiting.length >= maxItems) {
      break;
    }
    if (!awaitingInputJobUrls.has(entry.url)) {
      continue;
    }
    awaiting.push({ entry, group: "awaitingInput" });
    promotedJobUrls.add(entry.url);
  }
  groups.set("awaitingInput", awaiting);

  if (promotedJobUrls.size === 0) {
    return;
  }

  for (const group of ["failing", "unstable", "running"] as const) {
    const current = groups.get(group);
    if (!current) {
      continue;
    }
    groups.set(
      group,
      current.filter((item) => !promotedJobUrls.has(item.entry.url))
    );
  }
}

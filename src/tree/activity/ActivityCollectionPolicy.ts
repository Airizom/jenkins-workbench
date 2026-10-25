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

  const awaiting = groups.get("awaitingInput") ?? [];
  for (const entry of runningCandidates) {
    if (awaiting.length >= maxItems) {
      break;
    }
    if (awaitingInputJobUrls.has(entry.url)) {
      awaiting.push(entry);
    }
  }
  groups.set("awaitingInput", awaiting);
  groups.set(
    "running",
    runningCandidates.filter((entry) => !awaitingInputJobUrls.has(entry.url)).slice(0, maxItems)
  );
}

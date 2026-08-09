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

  promoteCandidatesToAwaitingInput(groups, runningCandidates, awaitingInputJobUrls, maxItems);
  removeAwaitingInputEntriesFromOtherGroups(groups, awaitingInputJobUrls);
  backfillRunningEntries(groups, runningCandidates, awaitingInputJobUrls, maxItems);
}

function backfillRunningEntries(
  groups: ActivityGroups,
  runningCandidates: JobSearchEntry[],
  excludedJobUrls: ReadonlySet<string>,
  maxItems: number
): void {
  const current = groups.get("running");
  if (!current) {
    return;
  }

  const backfilled: JobSearchEntry[] = [];
  const includedJobUrls = new Set<string>();
  for (const entry of [...runningCandidates, ...current]) {
    if (
      backfilled.length >= maxItems ||
      excludedJobUrls.has(entry.url) ||
      includedJobUrls.has(entry.url)
    ) {
      continue;
    }
    backfilled.push(entry);
    includedJobUrls.add(entry.url);
  }
  groups.set("running", backfilled);
}

function promoteCandidatesToAwaitingInput(
  groups: ActivityGroups,
  runningCandidates: JobSearchEntry[],
  awaitingInputJobUrls: ReadonlySet<string>,
  maxItems: number
): void {
  const awaiting = groups.get("awaitingInput") ?? [];
  for (const entry of runningCandidates) {
    if (awaiting.length >= maxItems) {
      break;
    }
    if (!awaitingInputJobUrls.has(entry.url)) {
      continue;
    }
    awaiting.push(entry);
  }
  groups.set("awaitingInput", awaiting);
}

function removeAwaitingInputEntriesFromOtherGroups(
  groups: ActivityGroups,
  awaitingInputJobUrls: ReadonlySet<string>
): void {
  for (const group of ["failing", "unstable", "running"] as const) {
    const current = groups.get(group);
    if (!current) {
      continue;
    }
    const filtered = current.filter((entry) => !awaitingInputJobUrls.has(entry.url));
    groups.set(group, filtered);
  }
}

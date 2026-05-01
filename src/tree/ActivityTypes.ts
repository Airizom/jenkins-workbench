import type { JenkinsJobKind } from "../jenkins/JenkinsClient";

export type ActivityGroupKind = "awaitingInput" | "failing" | "unstable" | "running";

export interface ActivityDisplayGroupSummary {
  kind: ActivityGroupKind;
  displayedCount: number;
  isTruncated: boolean;
}

export interface ActivityDisplaySummary {
  displayedTotal: number;
  limit: number;
  isTruncated: boolean;
  groups: ActivityDisplayGroupSummary[];
}

export interface ActivityJobViewModel {
  group: ActivityGroupKind;
  name: string;
  url: string;
  color?: string;
  kind: JenkinsJobKind;
  pathContext?: string;
}

export interface ActivityGroupViewModel {
  kind: ActivityGroupKind;
  items: ActivityJobViewModel[];
  displayedCount: number;
  isTruncated: boolean;
}

export interface ActivityViewModel {
  summary: ActivityDisplaySummary;
  groups: ActivityGroupViewModel[];
}

export interface ActivityCollectionOptions {
  maxScanResults: number;
  jobSearchBatchSize: number;
  pendingInputCandidateLimit: number;
  pendingInputLookupConcurrency: number;
  pendingInputBuildLookupLimit: number;
  refreshMinIntervalMs: number;
}

export interface TreeActivityOptions {
  maxItemsPerGroup: number;
  collection: ActivityCollectionOptions;
}

export const ACTIVITY_GROUP_ORDER: ActivityGroupKind[] = [
  "awaitingInput",
  "failing",
  "unstable",
  "running"
];

export function formatActivityGroupLabel(kind: ActivityGroupKind): string {
  switch (kind) {
    case "awaitingInput":
      return "Awaiting Input";
    case "failing":
      return "Failing";
    case "unstable":
      return "Unstable";
    case "running":
      return "Running";
  }
}

import type { JenkinsJobKind } from "../jenkins/JenkinsClient";

const ACTIVITY_GROUP_METADATA = [
  { kind: "awaitingInput", label: "Awaiting Input" },
  { kind: "failing", label: "Failing" },
  { kind: "unstable", label: "Unstable" },
  { kind: "running", label: "Running" }
] as const;

export type ActivityGroupKind = (typeof ACTIVITY_GROUP_METADATA)[number]["kind"];

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

export const ACTIVITY_GROUP_ORDER: ActivityGroupKind[] = ACTIVITY_GROUP_METADATA.map(
  ({ kind }) => kind
);

export function formatActivityGroupLabel(kind: ActivityGroupKind): string {
  return ACTIVITY_GROUP_METADATA.find((group) => group.kind === kind)?.label ?? kind;
}

import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import type { ActivityGroupKind } from "../ActivityTypes";

export interface ActivityEntry {
  entry: JobSearchEntry;
  group: ActivityGroupKind;
}

export type ActivityGroups = Map<ActivityGroupKind, ActivityEntry[]>;

import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import type { ActivityGroupKind } from "../ActivityTypes";

export type ActivityGroups = Map<ActivityGroupKind, JobSearchEntry[]>;

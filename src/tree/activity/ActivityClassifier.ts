import { resolveJobColorStatus } from "../../formatters/JobColorFormatters";
import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import type { ActivityGroupKind } from "../ActivityTypes";

export interface ActivityClassification {
  group: ActivityGroupKind;
}

export class ActivityClassifier {
  classify(entry: Pick<JobSearchEntry, "color">): ActivityClassification | undefined {
    const status = resolveJobColorStatus(entry.color);
    if (status === "running") {
      return { group: "running" };
    }
    if (status === "failed") {
      return { group: "failing" };
    }
    if (status === "unstable") {
      return { group: "unstable" };
    }
    return undefined;
  }
}

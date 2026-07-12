import { isRunningJobColor, resolveJobColorStatus } from "../../formatters/JobColorFormatters";
import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import type { ActivityGroupKind } from "../ActivityTypes";

export interface ActivityClassification {
  group: ActivityGroupKind;
  isRunning: boolean;
}

interface TreeActivityClassificationSurface {
  classify(entry: Pick<JobSearchEntry, "color">): ActivityClassification | undefined;
}

export class ActivityClassifier implements TreeActivityClassificationSurface {
  classify(entry: Pick<JobSearchEntry, "color">): ActivityClassification | undefined {
    const color = entry.color;
    if (!color) {
      return undefined;
    }

    const isRunning = isRunningJobColor(color);
    if (isRunning) {
      return { group: "running", isRunning };
    }

    const status = resolveJobColorStatus(color);
    if (status === "failed") {
      return { group: "failing", isRunning };
    }
    if (status === "unstable") {
      return { group: "unstable", isRunning };
    }
    return undefined;
  }
}

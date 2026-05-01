import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import type { ActivityGroupKind } from "../ActivityTypes";

export interface ActivityClassification {
  group: ActivityGroupKind;
  isRunning: boolean;
}

export class ActivityClassifier {
  classify(entry: Pick<JobSearchEntry, "color">): ActivityClassification | undefined {
    const color = entry.color;
    if (!color) {
      return undefined;
    }

    const isRunning = isRunningActivityColor(color);
    const normalized = color.toLowerCase();
    const base = normalized.split("_")[0] ?? normalized;
    if (base === "red") {
      return { group: "failing", isRunning };
    }
    if (base === "yellow") {
      return { group: "unstable", isRunning };
    }
    if (isRunning) {
      return { group: "running", isRunning };
    }
    return undefined;
  }
}

export function isRunningActivityColor(color?: string): boolean {
  return Boolean(color?.toLowerCase().endsWith("_anime"));
}

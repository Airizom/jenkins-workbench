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

    const normalized = color.toLowerCase();
    const isRunning = normalized.endsWith("_anime");
    const separatorIndex = normalized.indexOf("_");
    const base = separatorIndex === -1 ? normalized : normalized.slice(0, separatorIndex);
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

import { resolveJobColorStatus } from "../../formatters/JobColorFormatters";
import type { JobSearchEntry } from "../../jenkins/JenkinsDataService";
import type { ActivityGroupKind } from "../ActivityTypes";

export function classifyActivityGroup(
  entry: Pick<JobSearchEntry, "color">
): ActivityGroupKind | undefined {
  const status = resolveJobColorStatus(entry.color);
  if (status === "running") {
    return "running";
  }
  if (status === "failed") {
    return "failing";
  }
  if (status === "unstable") {
    return "unstable";
  }
  return undefined;
}

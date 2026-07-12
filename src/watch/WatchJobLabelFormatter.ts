import type { WatchedJobEntry } from "../storage/JenkinsWatchStore";

export function formatWatchJobLabel(entry: WatchedJobEntry, jobName?: string): string {
  const label = jobName ?? entry.jobName ?? entry.jobUrl;
  const kind = entry.jobKind === "pipeline" ? "Pipeline" : "Job";
  return `${kind} ${label}`;
}

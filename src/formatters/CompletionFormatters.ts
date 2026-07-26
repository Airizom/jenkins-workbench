import { resolveKnownBuildResult } from "./BuildStatusFormatters";
import {
  formatJobColorStatusLabel,
  type JobColorStatus,
  resolveJobColorStatus
} from "./JobColorFormatters";

type CompletionSeverity = "info" | "warning";

const JOB_COLOR_SEVERITY: Record<JobColorStatus, CompletionSeverity> = {
  success: "info",
  failed: "warning",
  unstable: "warning",
  aborted: "warning",
  notBuilt: "info",
  disabled: "info",
  running: "info",
  unknown: "info"
};

export function formatCompletionStatus(
  result?: unknown,
  color?: unknown
): { label: string; severity: CompletionSeverity } {
  if (typeof result === "string") {
    const knownResult = resolveKnownBuildResult(result);
    if (knownResult) {
      return knownResult;
    }
  }

  if (typeof color === "string" && color.trim()) {
    const status = resolveJobColorStatus(color);
    if (status) {
      return {
        label: formatJobColorStatusLabel(status),
        severity: JOB_COLOR_SEVERITY[status]
      };
    }
  }

  return { label: "Unknown", severity: "info" };
}

import {
  type BuildResultCompletionSeverity,
  resolveKnownBuildResult
} from "./BuildStatusFormatters";
import {
  formatJobColorStatusLabel,
  type JobColorStatus,
  resolveJobColorStatus
} from "./JobColorFormatters";

// Job colors that describe a finished build reuse the build-result label and severity.
const JOB_COLOR_RESULT_TOKEN: Partial<Record<JobColorStatus, string>> = {
  success: "SUCCESS",
  failed: "FAILURE",
  unstable: "UNSTABLE",
  aborted: "ABORTED",
  notBuilt: "NOT_BUILT"
};

export function formatCompletionStatus(
  result?: unknown,
  color?: unknown
): { label: string; severity: BuildResultCompletionSeverity } {
  if (typeof result === "string") {
    const knownResult = resolveKnownBuildResult(result);
    if (knownResult) {
      return knownResult;
    }
  }

  if (typeof color === "string" && color.trim()) {
    const status = resolveJobColorStatus(color);
    if (status) {
      return (
        resolveKnownBuildResult(JOB_COLOR_RESULT_TOKEN[status]) ?? {
          label: formatJobColorStatusLabel(status),
          severity: "info"
        }
      );
    }
  }

  return { label: "Unknown", severity: "info" };
}

import { resolveKnownBuildResult } from "./BuildStatusFormatters";
import {
  type JobColorStatus,
  formatJobColorStatusLabel,
  resolveJobColorStatus
} from "./JobColorFormatters";
import { normalizeStatusToken } from "./StatusTokenUtils";

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

const normalizeResult = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  return normalizeStatusToken(value);
};

export function formatCompletionStatus(
  result?: unknown,
  color?: unknown
): { label: string; severity: CompletionSeverity } {
  const normalizedResult = normalizeResult(result);
  if (normalizedResult) {
    const knownResult = resolveKnownBuildResult(normalizedResult);
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

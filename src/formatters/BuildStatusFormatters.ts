import { isFailedStatusToken, normalizeStatusToken } from "./StatusTokenUtils";

export type BuildResultClass =
  | "success"
  | "failure"
  | "unstable"
  | "aborted"
  | "running"
  | "neutral";

const BUILD_RESULT_BY_TOKEN: Record<string, { class: BuildResultClass; label: string }> = {
  SUCCESS: { class: "success", label: "Success" },
  FAILURE: { class: "failure", label: "Failed" },
  FAILED: { class: "failure", label: "Failed" },
  ERROR: { class: "failure", label: "Failed" },
  UNSTABLE: { class: "unstable", label: "Unstable" },
  ABORTED: { class: "aborted", label: "Aborted" },
  NOT_BUILT: { class: "neutral", label: "Not built" }
};

function normalizeBuildResultToken(result?: string): string {
  return normalizeStatusToken(result);
}

export function resolveBuildResultClass(result?: string, building?: boolean): BuildResultClass {
  if (building) {
    return "running";
  }

  return BUILD_RESULT_BY_TOKEN[normalizeBuildResultToken(result)]?.class ?? "neutral";
}

export function resolveBuildResultLabel(result?: string, building?: boolean): string {
  if (building) {
    return "Running";
  }

  const normalized = normalizeBuildResultToken(result);
  return BUILD_RESULT_BY_TOKEN[normalized]?.label ?? (result?.trim() || "Unknown");
}

export type BuildResultCompletionSeverity = "info" | "warning";

function resolveBuildResultCompletionSeverity(result?: string): BuildResultCompletionSeverity {
  const resultClass = resolveBuildResultClass(result);
  return resultClass === "success" || resultClass === "neutral" ? "info" : "warning";
}

export function resolveKnownBuildResult(
  result?: string
): { label: string; severity: BuildResultCompletionSeverity } | undefined {
  const normalized = normalizeBuildResultToken(result);
  const entry = BUILD_RESULT_BY_TOKEN[normalized];
  if (!entry) {
    return undefined;
  }

  return {
    label: entry.label,
    severity: resolveBuildResultCompletionSeverity(normalized)
  };
}

function isFailedBuildResult(result?: string): boolean {
  return isFailedStatusToken(result);
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function normalizePipelineStatus(status?: string): {
  label: string;
  className: BuildResultClass;
  isFailed: boolean;
} {
  const normalized = normalizeBuildResultToken(status);
  if (!normalized) {
    return { label: "Unknown", className: "neutral", isFailed: false };
  }

  if (normalized === "IN_PROGRESS" || normalized === "RUNNING") {
    return { label: "Running", className: "running", isFailed: false };
  }
  if (normalized === "PAUSED" || normalized === "QUEUED") {
    return {
      label: normalized === "PAUSED" ? "Paused" : "Queued",
      className: "running",
      isFailed: false
    };
  }
  if (normalized === "SKIPPED") {
    return { label: "Skipped", className: "neutral", isFailed: false };
  }

  const className = resolveBuildResultClass(normalized);
  if (className !== "neutral" || normalized === "NOT_BUILT") {
    return {
      label: resolveBuildResultLabel(normalized),
      className,
      isFailed: isFailedBuildResult(normalized)
    };
  }

  return {
    label: toTitleCase(normalized.replace(/_/g, " ").toLowerCase()),
    className: "neutral",
    isFailed: false
  };
}

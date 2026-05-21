export type BuildResultClass =
  | "success"
  | "failure"
  | "unstable"
  | "aborted"
  | "running"
  | "neutral";

export function resolveBuildResultClass(result?: string, building?: boolean): BuildResultClass {
  if (building) {
    return "running";
  }

  const normalized = (result ?? "").trim().toUpperCase();
  switch (normalized) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "FAILED":
    case "ERROR":
      return "failure";
    case "UNSTABLE":
      return "unstable";
    case "ABORTED":
      return "aborted";
    case "NOT_BUILT":
      return "neutral";
    default:
      return "neutral";
  }
}

export function resolveBuildResultLabel(result?: string, building?: boolean): string {
  if (building) {
    return "Running";
  }

  const normalized = (result ?? "").trim().toUpperCase();
  switch (normalized) {
    case "SUCCESS":
      return "Success";
    case "FAILURE":
    case "FAILED":
    case "ERROR":
      return "Failed";
    case "UNSTABLE":
      return "Unstable";
    case "ABORTED":
      return "Aborted";
    case "NOT_BUILT":
      return "Not built";
    default:
      return result?.trim() || "Unknown";
  }
}

export function isFailedBuildResult(result?: string): boolean {
  const normalized = (result ?? "").trim().toUpperCase();
  return (
    normalized === "FAILURE" ||
    normalized === "FAILED" ||
    normalized === "ERROR" ||
    normalized === "UNSTABLE" ||
    normalized === "ABORTED"
  );
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
  const normalized = (status ?? "").trim().toUpperCase();
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

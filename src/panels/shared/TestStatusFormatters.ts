export type NormalizedTestStatus = "passed" | "failed" | "skipped" | "other";

export function normalizeTestStatus(status?: string): NormalizedTestStatus {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) {
    return "other";
  }
  if (normalized === "PASSED" || normalized === "FIXED") {
    return "passed";
  }
  if (normalized === "SKIPPED" || normalized === "REGRESSION_SKIPPED") {
    return "skipped";
  }
  if (normalized === "FAILED" || normalized === "REGRESSION" || normalized === "ERROR") {
    return "failed";
  }
  return "other";
}

export function formatTestStatusLabel(status: NormalizedTestStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Other";
  }
}

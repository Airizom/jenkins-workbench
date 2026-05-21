export type CoverageStatusClass = "success" | "warning" | "failure" | "neutral";

export function normalizeCoverageStatusClass(status?: string): CoverageStatusClass | undefined {
  const normalized = status?.trim().toUpperCase();
  switch (normalized) {
    case "SUCCESS":
      return "success";
    case "WARNING":
    case "UNSTABLE":
      return "warning";
    case "ERROR":
    case "FAILURE":
    case "FAILED":
      return "failure";
    default:
      return normalized ? "neutral" : undefined;
  }
}

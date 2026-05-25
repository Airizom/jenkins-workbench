import { normalizeStatusToken } from "../../formatters/StatusTokenUtils";

export type StatusVisualTone = "passed" | "failed" | "skipped" | "neutral";

export type CoverageStatusClass = "success" | "warning" | "failure" | "neutral";

const COVERAGE_STATUS_BY_TOKEN: Record<string, CoverageStatusClass> = {
  SUCCESS: "success",
  WARNING: "warning",
  UNSTABLE: "warning",
  ERROR: "failure",
  FAILURE: "failure",
  FAILED: "failure",
  NEUTRAL: "neutral"
};

export function normalizeCoverageStatusClass(status?: string): CoverageStatusClass | undefined {
  const normalized = normalizeStatusToken(status);
  if (!normalized) {
    return undefined;
  }

  return COVERAGE_STATUS_BY_TOKEN[normalized] ?? "neutral";
}

export function resolveCoverageStatusClass(status?: string): CoverageStatusClass {
  return normalizeCoverageStatusClass(status) ?? "neutral";
}

export function coverageStatusClassToVisualTone(
  statusClass: CoverageStatusClass
): StatusVisualTone {
  switch (statusClass) {
    case "success":
      return "passed";
    case "warning":
      return "skipped";
    case "failure":
      return "failed";
    default:
      return "neutral";
  }
}

export function resolveStatusBadgeClass(tone: StatusVisualTone): string {
  switch (tone) {
    case "failed":
      return "border-failure-border-subtle text-failure";
    case "passed":
      return "border-success-border text-success";
    case "skipped":
      return "border-warning-border text-warning";
    default:
      return "border-border text-muted-foreground";
  }
}

export function resolveStatusBorderClass(tone: StatusVisualTone): string {
  switch (tone) {
    case "failed":
      return "border-l-2 border-l-failure";
    case "skipped":
      return "border-l-2 border-l-warning";
    default:
      return "";
  }
}

export function resolveMetricCardClass(tone: StatusVisualTone): string {
  switch (tone) {
    case "failed":
      return "border-failure-border-subtle bg-failure-surface";
    case "skipped":
      return "border-border bg-warning-surface";
    case "passed":
      return "border-success-border bg-success-soft";
    default:
      return "border-border bg-background";
  }
}

export function resolveMetricDotClass(tone: Exclude<StatusVisualTone, "neutral">): string {
  switch (tone) {
    case "failed":
      return "bg-failure";
    case "skipped":
      return "bg-warning";
    case "passed":
      return "bg-success";
  }
}

export function resolveMetricToneClass(tone: StatusVisualTone): string {
  switch (tone) {
    case "failed":
      return "text-failure";
    case "skipped":
      return "text-warning";
    case "passed":
      return "text-success";
    default:
      return "text-foreground";
  }
}

export function resolveCoverageStatusBadgeClass(statusClass?: string): string {
  const normalized = resolveCoverageStatusClass(statusClass);
  if (normalized === "warning") {
    return "border-border text-warning";
  }
  return resolveStatusBadgeClass(coverageStatusClassToVisualTone(normalized));
}

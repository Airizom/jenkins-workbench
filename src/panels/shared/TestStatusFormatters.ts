import { normalizeStatusToken } from "../../formatters/StatusTokenUtils";
import type { StatusVisualTone } from "./TestStatusStyles";

export type NormalizedTestStatus = "passed" | "failed" | "skipped" | "other";

export function testStatusToVisualTone(status: NormalizedTestStatus): StatusVisualTone {
  return status === "other" ? "neutral" : status;
}

export function normalizeTestStatus(status?: string): NormalizedTestStatus {
  const normalized = normalizeStatusToken(status);
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

export function getTestStatusSortRank(status: NormalizedTestStatus): number {
  switch (status) {
    case "failed":
      return 0;
    case "skipped":
      return 1;
    case "passed":
      return 2;
    default:
      return 3;
  }
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

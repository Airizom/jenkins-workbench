import type { StatusVisualTone } from "../../../../../shared/TestStatusStyles";
import type { CompareSectionStatus } from "../../../../shared/BuildCompareContracts";

export interface SectionStatusBadge {
  label: string;
  tone: StatusVisualTone;
}

/** Maps raw section status enums to human labels paired with semantic tones. */
export function resolveSectionStatusBadge(status: CompareSectionStatus): SectionStatusBadge {
  switch (status) {
    case "loading":
      return { label: "Loading…", tone: "neutral" };
    case "available":
      return { label: "Ready", tone: "neutral" };
    case "empty":
      return { label: "No differences", tone: "neutral" };
    case "unavailable":
      return { label: "No data", tone: "neutral" };
    case "error":
      return { label: "Error", tone: "failed" };
    case "tooLarge":
      return { label: "Too large to compare", tone: "skipped" };
    case "identical":
      return { label: "Identical", tone: "passed" };
    default:
      return { label: "No data", tone: "neutral" };
  }
}

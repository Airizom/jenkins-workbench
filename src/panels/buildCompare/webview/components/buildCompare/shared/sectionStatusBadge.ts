import type { StatusVisualTone } from "../../../../../shared/TestStatusStyles";
import type { CompareSectionStatus } from "../../../../shared/BuildCompareContracts";

export interface SectionStatusBadge {
  label: string;
  tone: StatusVisualTone;
}

/**
 * Maps raw section status enums to human labels paired with semantic tones.
 * A populated section speaks for itself, so `available` gets no badge; only
 * states that explain missing or partial content are called out.
 */
export function resolveSectionStatusBadge(status: CompareSectionStatus): SectionStatusBadge | null {
  switch (status) {
    case "available":
      return null;
    case "loading":
      return { label: "Loading…", tone: "neutral" };
    case "empty":
      return { label: "No changes", tone: "neutral" };
    case "unavailable":
      return { label: "No data", tone: "neutral" };
    case "error":
      return { label: "Error", tone: "failed" };
    case "tooLarge":
      return { label: "Too large to compare", tone: "skipped" };
    case "identical":
      return { label: "Identical", tone: "passed" };
  }
}

import type { JenkinsBuildDetails } from "../../jenkins/types";
import { trimToUndefined } from "../../shared/stringValues";
import { formatBuildHeaderLabels } from "../buildDetails/BuildDetailsFormatters";
import type { BuildCompareBuildViewModel } from "./shared/BuildCompareContracts";

export function buildBuildViewModel(
  roleLabel: string,
  details: JenkinsBuildDetails
): BuildCompareBuildViewModel {
  const headerLabels = formatBuildHeaderLabels(details);
  return {
    roleLabel,
    displayName: details.fullDisplayName ?? details.displayName ?? roleLabel,
    buildUrl: details.url,
    ...headerLabels
  };
}

export const normalizeString = trimToUndefined;

export function buildOccurrenceKey(base: string, occurrence: number): string {
  return `${base}::${occurrence}`;
}

export function buildComparisonErrorDetail(
  label: string,
  baselineMessage?: string,
  targetMessage?: string
): string {
  if (baselineMessage && targetMessage) {
    return `Baseline ${label.toLowerCase()}: ${baselineMessage} Target ${label.toLowerCase()}: ${targetMessage}`;
  }
  if (baselineMessage) {
    return `Baseline ${label.toLowerCase()}: ${baselineMessage}`;
  }
  if (targetMessage) {
    return `Target ${label.toLowerCase()}: ${targetMessage}`;
  }
  return `${label} comparison failed.`;
}

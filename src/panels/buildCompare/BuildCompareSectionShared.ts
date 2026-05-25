import type { JenkinsBuildDetails } from "../../jenkins/types";
import { formatBuildHeaderLabels } from "../../shared/build/BuildHeaderLabels";
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

export function createCompareErrorSection<T>(
  summaryLabel: string,
  detail: string | undefined,
  fields: T
): T & { status: "error"; summaryLabel: string; detail?: string } {
  return {
    status: "error",
    summaryLabel,
    detail,
    ...fields
  };
}

export function createCompareUnavailableSection<T>(
  summaryLabel: string,
  detail: string | undefined,
  fields: T
): T & { status: "unavailable"; summaryLabel: string; detail?: string } {
  return {
    status: "unavailable",
    summaryLabel,
    detail,
    ...fields
  };
}

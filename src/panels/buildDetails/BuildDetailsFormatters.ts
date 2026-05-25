import type { JenkinsBuildDetails } from "../../jenkins/types";
import {
  formatBuildDuration,
  formatBuildHeaderLabels,
  formatBuildResultClass,
  formatBuildResultLabel,
  formatBuildTimestamp
} from "../../shared/build/BuildHeaderLabels";

export { formatBuildHeaderLabels } from "../../shared/build/BuildHeaderLabels";

export function formatBuildDetailsHeaderLabels(details?: JenkinsBuildDetails): {
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
} {
  return {
    ...formatBuildHeaderLabels(details),
    culpritsLabel: details ? formatCulprits(details.culprits) : "Unknown"
  };
}

export function formatResult(details: JenkinsBuildDetails): string {
  return formatBuildResultLabel(details);
}

export function formatResultClass(details: JenkinsBuildDetails): string {
  return formatBuildResultClass(details);
}

export function formatDuration(duration?: number): string {
  return formatBuildDuration(duration);
}

export function formatTimestamp(timestamp?: number): string {
  return formatBuildTimestamp(timestamp);
}

export function formatCulprits(culprits: JenkinsBuildDetails["culprits"] | undefined): string {
  if (!culprits || culprits.length === 0) {
    return "None";
  }
  return culprits.map((culprit) => culprit.fullName).join(", ");
}

export function truncateConsoleText(
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(text.length - maxChars),
    truncated: true
  };
}

export { formatNumber } from "../../formatters/DisplayFormatters";
export { formatError } from "../../formatters/ErrorFormatters";
export { normalizePipelineStatus } from "../../formatters/BuildStatusFormatters";

import {
  resolveBuildResultClass,
  resolveBuildResultLabel
} from "../../formatters/BuildStatusFormatters";
import { formatOptionalLocaleTimestamp } from "../../formatters/DisplayFormatters";
import {
  formatCompactDurationFromTotalSeconds,
  formatDurationMs
} from "../../formatters/DurationFormatters";
import type { JenkinsBuildDetails } from "../../jenkins/types";

export function formatBuildHeaderLabels(details?: JenkinsBuildDetails): {
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
} {
  return {
    resultLabel: details ? formatResult(details) : "Unknown",
    resultClass: details ? formatResultClass(details) : "neutral",
    durationLabel: details ? formatDuration(details.duration) : "Unknown",
    timestampLabel: details ? formatTimestamp(details.timestamp) : "Unknown"
  };
}

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
  return resolveBuildResultLabel(details.result, details.building);
}

export function formatResultClass(details: JenkinsBuildDetails): string {
  return resolveBuildResultClass(details.result, details.building);
}

export function formatDuration(duration?: number): string {
  return formatDurationMs(duration);
}

export function formatTestDuration(durationSeconds?: number): string | undefined {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return undefined;
  }
  if (durationSeconds < 1) {
    return `${Math.round(durationSeconds * 1000)} ms`;
  }
  if (durationSeconds < 60) {
    const rounded = Math.round(durationSeconds * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} s`;
  }
  return formatCompactDurationFromTotalSeconds(Math.round(durationSeconds));
}

export function formatTimestamp(timestamp?: number): string {
  if (timestamp === undefined) {
    return "Unknown";
  }
  return formatOptionalLocaleTimestamp(timestamp) || "Unknown";
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

import {
  resolveBuildResultClass,
  resolveBuildResultLabel
} from "../../formatters/BuildStatusFormatters";
import { formatOptionalLocaleTimestamp } from "../../formatters/DisplayFormatters";
import { formatDurationMs } from "../../formatters/DurationFormatters";
import type { JenkinsBuildDetails } from "../../jenkins/types";

export function formatBuildResultLabel(details: JenkinsBuildDetails): string {
  return resolveBuildResultLabel(details.result, details.building);
}

export function formatBuildResultClass(details: JenkinsBuildDetails): string {
  return resolveBuildResultClass(details.result, details.building);
}

export function formatBuildDuration(duration?: number): string {
  return formatDurationMs(duration);
}

export function formatBuildTimestamp(timestamp?: number): string {
  if (timestamp === undefined) {
    return "Unknown";
  }
  return formatOptionalLocaleTimestamp(timestamp) || "Unknown";
}

export function formatBuildHeaderLabels(details?: JenkinsBuildDetails): {
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
} {
  return {
    resultLabel: details ? formatBuildResultLabel(details) : "Unknown",
    resultClass: details ? formatBuildResultClass(details) : "neutral",
    durationLabel: details ? formatBuildDuration(details.duration) : "Unknown",
    timestampLabel: details ? formatBuildTimestamp(details.timestamp) : "Unknown"
  };
}

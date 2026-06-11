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

function formatBuildResultClass(details: JenkinsBuildDetails): string {
  return resolveBuildResultClass(details.result, details.building);
}

export function formatBuildDuration(duration?: number): string {
  return formatDurationMs(duration);
}

function formatBuildTimestamp(timestamp?: number): string {
  if (timestamp === undefined) {
    return "Unknown";
  }
  return formatOptionalLocaleTimestamp(timestamp) || "Unknown";
}

export interface BuildHeaderViewModel {
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
}

export function formatBuildHeaderLabels(details?: JenkinsBuildDetails): BuildHeaderViewModel {
  return {
    resultLabel: details ? formatBuildResultLabel(details) : "Unknown",
    resultClass: details ? formatBuildResultClass(details) : "neutral",
    durationLabel: details ? formatBuildDuration(details.duration) : "Unknown",
    timestampLabel: details ? formatBuildTimestamp(details.timestamp) : "Unknown"
  };
}

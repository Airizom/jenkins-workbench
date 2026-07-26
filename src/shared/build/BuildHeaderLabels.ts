import {
  resolveBuildResultClass,
  resolveBuildResultLabel
} from "../../formatters/BuildStatusFormatters";
import { formatOptionalLocaleTimestamp } from "../../formatters/DisplayFormatters";
import { formatDurationMs } from "../../formatters/DurationFormatters";
import type { JenkinsBuildDetails } from "../../jenkins/types";

const UNKNOWN_LABEL = "Unknown";

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
    return UNKNOWN_LABEL;
  }
  return formatOptionalLocaleTimestamp(timestamp) || UNKNOWN_LABEL;
}

export interface BuildHeaderViewModel {
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
}

export function formatBuildHeaderLabels(details?: JenkinsBuildDetails): BuildHeaderViewModel {
  if (!details) {
    return {
      resultLabel: UNKNOWN_LABEL,
      resultClass: "neutral",
      durationLabel: UNKNOWN_LABEL,
      timestampLabel: UNKNOWN_LABEL
    };
  }

  return {
    resultLabel: formatBuildResultLabel(details),
    resultClass: formatBuildResultClass(details),
    durationLabel: formatBuildDuration(details.duration),
    timestampLabel: formatBuildTimestamp(details.timestamp)
  };
}

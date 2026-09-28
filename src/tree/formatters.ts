import * as vscode from "vscode";
import {
  type BuildResultClass,
  resolveBuildResultClass,
  resolveBuildResultLabel
} from "../formatters/BuildStatusFormatters";
import { formatDurationMs, formatQueueDuration } from "../formatters/DurationFormatters";
import {
  formatJobColorStatusLabel,
  isJobColorDisabled,
  type JobColorStatus,
  resolveJobColorIconId,
  resolveJobColorStatus
} from "../formatters/JobColorFormatters";
import { formatRelativeTimestampMs } from "../formatters/RelativeTimeFormatters";
import { normalizeStatusToken } from "../formatters/StatusTokenUtils";
import type { JenkinsBuild } from "../jenkins/JenkinsClient";
import { parseJobUrl } from "../jenkins/urls";
import { resolveBuildElapsedMs } from "./BuildTiming";

type NormalizedStatus = JobColorStatus;

const STATUS_THEME_COLORS: Record<NormalizedStatus, vscode.ThemeColor> = {
  success: new vscode.ThemeColor("charts.green"),
  failed: new vscode.ThemeColor("charts.red"),
  unstable: new vscode.ThemeColor("charts.yellow"),
  aborted: new vscode.ThemeColor("charts.gray"),
  notBuilt: new vscode.ThemeColor("charts.gray"),
  disabled: new vscode.ThemeColor("charts.gray"),
  running: new vscode.ThemeColor("charts.blue"),
  unknown: new vscode.ThemeColor("charts.gray")
};

// The status-colored icon already conveys these; spelling them out on every row buries the
// failures and running jobs that need attention.
const QUIET_JOB_STATUS_LABELS = new Set([
  formatJobColorStatusLabel("success"),
  formatJobColorStatusLabel("unknown")
]);

// Awaiting input needs the user, so it must not share running's blue.
export const AWAITING_INPUT_THEME_COLOR = new vscode.ThemeColor("charts.orange");

export function formatJobColor(color?: string): string | undefined {
  const status = resolveJobColorStatus(color);
  if (!status) {
    return undefined;
  }
  return formatJobColorStatusLabel(status);
}

export function formatBuildDescription(build: JenkinsBuild, awaitingInput = false): string {
  if (build.building) {
    const parts = awaitingInput ? ["Awaiting input"] : ["Running"];
    const progress = formatRunningProgress(build);
    if (progress) {
      parts.push(progress);
    }
    return parts.join(" • ");
  }

  const parts = [resolveBuildResultLabel(build.result, build.building)];
  const durationLabel = formatDurationLabel(build.duration);
  if (durationLabel) {
    parts.push(durationLabel);
  }
  const finishedAt = resolveBuildFinishedAtMs(build);
  const relative = finishedAt === undefined ? undefined : formatRelativeTimestampMs(finishedAt);
  if (relative) {
    parts.push(relative);
  }
  return parts.join(" • ");
}

// Text-only progress so screen readers do not announce a character-art bar, and so a build
// that overruns its estimate reads as overdue instead of sitting at a clamped 100%.
function formatRunningProgress(build: JenkinsBuild): string | undefined {
  const elapsedMs = resolveBuildElapsedMs(build);
  const elapsedLabel = formatDurationLabel(elapsedMs);
  if (elapsedMs === undefined || !elapsedLabel) {
    return undefined;
  }
  const estimatedMs = build.estimatedDuration;
  if (typeof estimatedMs !== "number" || !Number.isFinite(estimatedMs) || estimatedMs <= 0) {
    return elapsedLabel;
  }
  const estimateLabel = formatDurationMs(estimatedMs);
  return elapsedMs > estimatedMs
    ? `${elapsedLabel}, over ~${estimateLabel} estimate`
    : `${elapsedLabel} of ~${estimateLabel}`;
}

function resolveBuildFinishedAtMs(build: JenkinsBuild): number | undefined {
  if (typeof build.timestamp !== "number" || !Number.isFinite(build.timestamp)) {
    return undefined;
  }
  const duration =
    typeof build.duration === "number" && Number.isFinite(build.duration) ? build.duration : 0;
  return build.timestamp + Math.max(0, duration);
}

export function buildIcon(build: JenkinsBuild, awaitingInput = false): vscode.ThemeIcon {
  if (awaitingInput) {
    return new vscode.ThemeIcon("debug-pause", AWAITING_INPUT_THEME_COLOR);
  }
  const status = resolveBuildStatus(build);
  if (status === "running") {
    return new vscode.ThemeIcon("sync~spin", STATUS_THEME_COLORS.running);
  }
  return new vscode.ThemeIcon(resolveJobColorIconId(status), STATUS_THEME_COLORS[status]);
}

export function jobIcon(kind: "job" | "pipeline", color?: string): vscode.ThemeIcon {
  const iconId = kind === "pipeline" ? "symbol-structure" : "gear";
  const status = resolveJobColorStatus(color);
  return new vscode.ThemeIcon(iconId, status ? STATUS_THEME_COLORS[status] : undefined);
}

export function formatJobDescription(options: {
  status?: string;
  isWatched?: boolean;
  isPinned?: boolean;
  isDisabled?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (options.status && !QUIET_JOB_STATUS_LABELS.has(options.status)) {
    parts.push(options.status);
  }
  if (options.isDisabled && options.status?.toLowerCase() !== "disabled") {
    parts.push("Disabled");
  }
  if (options.isPinned) {
    parts.push("Pinned");
  }
  if (options.isWatched) {
    parts.push("Watched");
  }
  return parts.length > 0 ? parts.join(" • ") : undefined;
}

export function formatPinnedJobPathContext(jobUrl: string): string | undefined {
  const parsed = parseJobUrl(jobUrl);
  if (!parsed || parsed.fullPath.length <= 1) {
    return undefined;
  }

  return parsed.fullPath.slice(0, -1).join(" / ");
}

export function formatPinnedJobTooltip(label: string, jobUrl: string, details?: string): string {
  const parsed = parseJobUrl(jobUrl);
  const fullPath = parsed?.fullPath.join(" / ");
  const lines = [label];

  if (fullPath && fullPath !== label) {
    lines.push(fullPath);
  }

  if (details) {
    lines.push(details);
  }

  return lines.join("\n");
}

export function formatQueueItemDescription(
  position: number,
  inQueueSince?: number
): string | undefined {
  const parts: string[] = [];

  if (Number.isFinite(position) && position > 0) {
    parts.push(`#${position} in queue`);
  }

  const duration = formatQueueDuration(inQueueSince);
  if (duration) {
    parts.push(`waiting ${duration}`);
  }

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

export function normalizeQueueReason(reason?: string): string | undefined {
  const trimmed = reason?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveBuildStatus(build: JenkinsBuild): NormalizedStatus {
  return mapBuildResultClassToTreeStatus(
    resolveBuildResultClass(build.result, build.building),
    build.result
  );
}

function mapBuildResultClassToTreeStatus(
  resultClass: BuildResultClass,
  result?: string
): NormalizedStatus {
  switch (resultClass) {
    case "success":
      return "success";
    case "failure":
      return "failed";
    case "unstable":
      return "unstable";
    case "aborted":
      return "aborted";
    case "running":
      return "running";
    case "neutral": {
      return normalizeStatusToken(result) === "NOT_BUILT" ? "notBuilt" : "unknown";
    }
  }
}

export { isJobColorDisabled };

function formatDurationLabel(durationMs?: number): string | undefined {
  if (!Number.isFinite(durationMs)) {
    return undefined;
  }
  return formatDurationMs(Math.max(0, durationMs as number));
}

export { formatDurationMs };

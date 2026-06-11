import * as vscode from "vscode";
import {
  type BuildResultClass,
  resolveBuildResultClass,
  resolveBuildResultLabel
} from "../formatters/BuildStatusFormatters";
import { formatDurationMs, formatQueueDuration } from "../formatters/DurationFormatters";
import {
  type JobColorStatus,
  formatJobColorStatusLabel,
  isJobColorDisabled,
  resolveJobColorIconId,
  resolveJobColorStatus
} from "../formatters/JobColorFormatters";
import { formatRelativeTimestampMs } from "../formatters/RelativeTimeFormatters";
import { normalizeStatusToken } from "../formatters/StatusTokenUtils";
import type { JenkinsBuild, JenkinsNode } from "../jenkins/JenkinsClient";
import { formatNodeTreeDescription } from "../jenkins/NodeFormatters";
import { parseJobUrl } from "../jenkins/urls";
import { clampPercent } from "../shared/numbers";
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

export function formatJobColor(color?: string): string | undefined {
  const status = resolveJobStatus(color);
  if (!status) {
    return undefined;
  }
  return formatJobColorStatusLabel(status);
}

function formatBuildStatus(build: JenkinsBuild): string {
  return resolveBuildResultLabel(build.result, build.building);
}

export function formatBuildDescription(build: JenkinsBuild, awaitingInput = false): string {
  if (build.building) {
    const elapsedMs = resolveBuildElapsedMs(build);
    const estimatedMs = Number.isFinite(build.estimatedDuration)
      ? (build.estimatedDuration as number)
      : undefined;

    if (Number.isFinite(elapsedMs) && typeof estimatedMs === "number" && estimatedMs > 0) {
      const progressPercentRaw = Math.floor(((elapsedMs as number) / estimatedMs) * 100);
      const progressPercent = clampPercent(progressPercentRaw);
      const progressBar = formatProgressBar(progressPercent, 10);
      const base = `Running ${progressPercent}% ${progressBar}`;
      return awaitingInput ? `${base} • Awaiting input` : base;
    }

    const elapsedLabel = formatDurationLabel(elapsedMs);
    const base = elapsedLabel ? `Running ${elapsedLabel}` : "Running";
    return awaitingInput ? `${base} • Awaiting input` : base;
  }

  const status = formatBuildStatus(build);
  const durationLabel = formatDurationLabel(build.duration);
  return durationLabel ? `${status} • ${durationLabel}` : status;
}

export function formatRelativeTime(timestampMs: number): string | undefined {
  return formatRelativeTimestampMs(timestampMs);
}

export function formatNodeDescription(node: JenkinsNode): string {
  return formatNodeTreeDescription(node);
}

export function buildIcon(build: JenkinsBuild, awaitingInput = false): vscode.ThemeIcon {
  if (awaitingInput) {
    return new vscode.ThemeIcon("debug-pause", STATUS_THEME_COLORS.running);
  }
  const status = resolveBuildStatus(build);
  if (status === "running") {
    return new vscode.ThemeIcon("sync~spin", STATUS_THEME_COLORS.running);
  }
  return new vscode.ThemeIcon(buildIconId(status), STATUS_THEME_COLORS[status]);
}

export function jobIcon(kind: "job" | "pipeline", color?: string): vscode.ThemeIcon {
  const iconId = kind === "pipeline" ? "symbol-structure" : "gear";
  const status = resolveJobStatus(color);
  return new vscode.ThemeIcon(iconId, status ? STATUS_THEME_COLORS[status] : undefined);
}

export function formatJobDescription(options: {
  status?: string;
  isWatched?: boolean;
  isPinned?: boolean;
  isDisabled?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (options.status) {
    parts.push(options.status);
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

export function formatPinnedJobTooltip(
  label: string,
  jobUrl: string,
  details?: string
): string | undefined {
  const parsed = parseJobUrl(jobUrl);
  const fullPath = parsed?.fullPath.join(" / ");
  const lines = [label];

  if (fullPath && fullPath !== label) {
    lines.push(fullPath);
  }

  if (details) {
    lines.push(details);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
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

function buildIconId(status: NormalizedStatus): string {
  return resolveJobColorIconId(status);
}

export { isJobColorDisabled };

function resolveJobStatus(color?: string): NormalizedStatus | undefined {
  return resolveJobColorStatus(color);
}

function formatDurationLabel(durationMs?: number): string | undefined {
  if (!Number.isFinite(durationMs)) {
    return undefined;
  }
  return formatDurationMs(Math.max(0, durationMs as number));
}

function formatProgressBar(percent: number, width: number): string {
  const clamped = clampPercent(percent);
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  const filledBar = "#".repeat(filled);
  const emptyBar = "-".repeat(empty);
  return `[${filledBar}${emptyBar}]`;
}

export { formatDurationMs };

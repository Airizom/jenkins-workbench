import * as vscode from "vscode";
import type { JenkinsBuild, JenkinsNode } from "../jenkins/JenkinsClient";

type NormalizedStatus =
  | "success"
  | "failed"
  | "unstable"
  | "aborted"
  | "notBuilt"
  | "disabled"
  | "running"
  | "unknown";

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

  switch (status) {
    case "success":
      return "Success";
    case "failed":
      return "Failed";
    case "unstable":
      return "Unstable";
    case "aborted":
      return "Aborted";
    case "notBuilt":
      return "Not built";
    case "disabled":
      return "Disabled";
    case "running":
      return "Running";
    default:
      return undefined;
  }
}

export function formatBuildStatus(build: JenkinsBuild): string {
  if (build.building) {
    return "Running";
  }

  if (!build.result) {
    return "Unknown";
  }

  switch (build.result) {
    case "SUCCESS":
      return "Success";
    case "FAILURE":
      return "Failed";
    case "UNSTABLE":
      return "Unstable";
    case "ABORTED":
      return "Aborted";
    case "NOT_BUILT":
      return "Not built";
    default:
      return build.result;
  }
}

export function formatBuildDescription(build: JenkinsBuild): string {
  if (build.building) {
    const elapsedLabel = formatDurationLabel(resolveBuildElapsedMs(build));
    if (elapsedLabel) {
      return `$(clock) ${elapsedLabel} • Running`;
    }
    return "Running";
  }

  const status = formatBuildStatus(build);
  const durationLabel = formatDurationLabel(build.duration);
  const completionTimestamp = resolveBuildCompletionTimestamp(build);
  const relativeLabel = completionTimestamp
    ? formatRelativeTime(completionTimestamp)
    : undefined;

  const base = durationLabel ? `${status} (${durationLabel})` : status;
  return relativeLabel ? `${base} • ${relativeLabel}` : base;
}

export function formatRelativeTime(timestampMs: number): string | undefined {
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  const now = Date.now();
  const diffMs = Math.max(0, now - timestampMs);
  const minuteMs = 60_000;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;

  if (diffMs < hourMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    return `${minutes}m ago`;
  }

  if (diffMs < dayMs) {
    const hours = Math.floor(diffMs / hourMs);
    return `${hours}h ago`;
  }

  const days = Math.floor(diffMs / dayMs);
  if (days === 1) {
    return "yesterday";
  }
  if (days < 7) {
    return `${days} days ago`;
  }

  return new Date(timestampMs).toLocaleDateString();
}

export function formatNodeDescription(node: JenkinsNode): string {
  if (node.offline) {
    return node.temporarilyOffline ? "Temporarily offline" : "Offline";
  }

  const totalExecutors = node.numExecutors;
  const busyExecutors = node.busyExecutors;
  if (Number.isFinite(totalExecutors) && Number.isFinite(busyExecutors)) {
    const freeExecutors = Math.max(
      0,
      (totalExecutors as number) - (busyExecutors as number)
    );
    return `Online (${freeExecutors}/${totalExecutors})`;
  }

  return "Online";
}

export function buildIcon(build: JenkinsBuild): vscode.ThemeIcon {
  const status = resolveBuildStatus(build);
  if (status === "running") {
    return new vscode.ThemeIcon("sync~spin", STATUS_THEME_COLORS.running);
  }
  return new vscode.ThemeIcon(buildIconId(status), STATUS_THEME_COLORS[status]);
}

export function jobIcon(kind: "job" | "pipeline", color?: string): vscode.ThemeIcon {
  const iconId = kind === "pipeline" ? "symbol-structure" : "tools";
  const status = resolveJobStatus(color);
  return new vscode.ThemeIcon(iconId, status ? STATUS_THEME_COLORS[status] : undefined);
}

export function formatWatchedDescription(
  status?: string,
  isWatched = false
): string | undefined {
  if (!isWatched) {
    return status;
  }

  if (!status) {
    return "$(eye)";
  }

  return `${status} • $(eye)`;
}

export function formatQueueItemDescription(
  position: number,
  inQueueSince?: number,
  reason?: string
): string | undefined {
  const parts: string[] = [];

  if (Number.isFinite(position) && position > 0) {
    parts.push(`#${position} in queue`);
  }

  const duration = formatQueueDuration(inQueueSince);
  if (duration) {
    parts.push(`waiting ${duration}`);
  }

  const normalizedReason = normalizeQueueReason(reason);
  if (normalizedReason) {
    parts.push(`"${normalizedReason}"`);
  }

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

export function formatQueueDuration(inQueueSince?: number): string | undefined {
  if (!Number.isFinite(inQueueSince)) {
    return undefined;
  }

  const durationMs = Math.max(0, Date.now() - (inQueueSince as number));
  return formatDurationMs(durationMs);
}

export function normalizeQueueReason(reason?: string): string | undefined {
  const trimmed = reason?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveBuildStatus(build: JenkinsBuild): NormalizedStatus {
  if (build.building) {
    return "running";
  }

  switch (build.result) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
      return "failed";
    case "UNSTABLE":
      return "unstable";
    case "ABORTED":
      return "aborted";
    case "NOT_BUILT":
      return "notBuilt";
    default:
      return "unknown";
  }
}

function buildIconId(status: NormalizedStatus): string {
  switch (status) {
    case "success":
      return "check";
    case "failed":
      return "error";
    case "unstable":
      return "warning";
    case "aborted":
      return "circle-slash";
    case "notBuilt":
      return "circle-outline";
    default:
      return "symbol-misc";
  }
}

export function resolveJobStatus(color?: string): NormalizedStatus | undefined {
  if (!color) {
    return undefined;
  }

  const isRunning = color.endsWith("_anime");
  const baseColor = isRunning ? color.slice(0, -"_anime".length) : color;

  let status: NormalizedStatus;
  switch (baseColor) {
    case "blue":
      status = "success";
      break;
    case "red":
      status = "failed";
      break;
    case "yellow":
      status = "unstable";
      break;
    case "aborted":
      status = "aborted";
      break;
    case "notbuilt":
      status = "notBuilt";
      break;
    case "disabled":
    case "grey":
    case "gray":
      status = "disabled";
      break;
    default:
      status = "unknown";
      break;
  }

  return isRunning ? "running" : status;
}

function resolveBuildCompletionTimestamp(build: JenkinsBuild): number | undefined {
  if (!Number.isFinite(build.timestamp)) {
    return undefined;
  }

  const timestamp = build.timestamp as number;
  if (Number.isFinite(build.duration)) {
    return timestamp + (build.duration as number);
  }

  return timestamp;
}

function resolveBuildElapsedMs(build: JenkinsBuild): number | undefined {
  if (Number.isFinite(build.timestamp)) {
    return Math.max(0, Date.now() - (build.timestamp as number));
  }

  if (Number.isFinite(build.duration)) {
    return Math.max(0, build.duration as number);
  }

  return undefined;
}

function formatDurationLabel(durationMs?: number): string | undefined {
  if (!Number.isFinite(durationMs)) {
    return undefined;
  }
  return formatDurationMs(Math.max(0, durationMs as number));
}

function formatDurationMs(duration: number): string {
  if (!Number.isFinite(duration)) {
    return "Unknown";
  }
  if (duration < 1000) {
    return `${Math.max(0, Math.floor(duration))} ms`;
  }
  const totalSeconds = Math.floor(duration / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

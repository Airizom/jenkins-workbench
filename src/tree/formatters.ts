import * as vscode from "vscode";
import type { JenkinsBuild } from "../jenkins/JenkinsClient";

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
    parts.push(`Pos ${position}`);
  }

  const duration = formatQueueDuration(inQueueSince);
  if (duration) {
    parts.push(duration);
  }

  const normalizedReason = normalizeQueueReason(reason);
  if (normalizedReason) {
    parts.push(normalizedReason);
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

import * as vscode from "vscode";
import type { JenkinsBuild } from "../jenkins/JenkinsClient";

export function formatJobColor(color?: string): string | undefined {
  if (!color) {
    return undefined;
  }

  if (color.endsWith("_anime")) {
    return "Running";
  }

  switch (color) {
    case "blue":
      return "Success";
    case "red":
      return "Failed";
    case "yellow":
      return "Unstable";
    case "aborted":
      return "Aborted";
    case "notbuilt":
      return "Not built";
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
  if (build.building) {
    return new vscode.ThemeIcon("sync");
  }

  if (!build.result) {
    return new vscode.ThemeIcon("symbol-misc");
  }

  switch (build.result) {
    case "SUCCESS":
      return new vscode.ThemeIcon("check");
    case "FAILURE":
      return new vscode.ThemeIcon("error");
    case "UNSTABLE":
      return new vscode.ThemeIcon("warning");
    case "ABORTED":
      return new vscode.ThemeIcon("circle-slash");
    case "NOT_BUILT":
      return new vscode.ThemeIcon("circle-outline");
    default:
      return new vscode.ThemeIcon("symbol-misc");
  }
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

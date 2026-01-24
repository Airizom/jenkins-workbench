import type { JenkinsBuildDetails } from "../../jenkins/types";

export function formatResult(details: JenkinsBuildDetails): string {
  if (details.building) {
    return "Running";
  }
  return details.result ?? "Unknown";
}

export function formatResultClass(details: JenkinsBuildDetails): string {
  if (details.building) {
    return "running";
  }
  const result = (details.result ?? "").toUpperCase();
  if (result === "SUCCESS") {
    return "success";
  }
  if (result === "FAILURE") {
    return "failure";
  }
  if (result === "UNSTABLE") {
    return "unstable";
  }
  if (result === "ABORTED") {
    return "aborted";
  }
  if (result === "NOT_BUILT") {
    return "neutral";
  }
  return "neutral";
}

export function formatDuration(duration?: number): string {
  if (duration === undefined) {
    return "Unknown";
  }
  if (duration < 1000) {
    return `${duration} ms`;
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
  const totalSeconds = Math.round(durationSeconds);
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

export function formatTimestamp(timestamp?: number): string {
  if (timestamp === undefined) {
    return "Unknown";
  }
  return new Date(timestamp).toLocaleString();
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { formatError } from "../../formatters/ErrorFormatters";

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function normalizePipelineStatus(status?: string): {
  label: string;
  className: string;
  isFailed: boolean;
} {
  const normalized = (status ?? "").trim().toUpperCase();
  if (!normalized) {
    return { label: "Unknown", className: "neutral", isFailed: false };
  }
  if (normalized === "SUCCESS") {
    return { label: "Success", className: "success", isFailed: false };
  }
  if (normalized === "FAILURE" || normalized === "FAILED" || normalized === "ERROR") {
    return { label: "Failed", className: "failure", isFailed: true };
  }
  if (normalized === "UNSTABLE") {
    return { label: "Unstable", className: "unstable", isFailed: true };
  }
  if (normalized === "ABORTED") {
    return { label: "Aborted", className: "aborted", isFailed: true };
  }
  if (normalized === "IN_PROGRESS" || normalized === "RUNNING") {
    return { label: "Running", className: "running", isFailed: false };
  }
  if (normalized === "PAUSED") {
    return { label: "Paused", className: "running", isFailed: false };
  }
  if (normalized === "QUEUED") {
    return { label: "Queued", className: "running", isFailed: false };
  }
  if (normalized === "NOT_BUILT") {
    return { label: "Not built", className: "neutral", isFailed: false };
  }
  if (normalized === "SKIPPED") {
    return { label: "Skipped", className: "neutral", isFailed: false };
  }
  return {
    label: toTitleCase(normalized.replace(/_/g, " ").toLowerCase()),
    className: "neutral",
    isFailed: false
  };
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

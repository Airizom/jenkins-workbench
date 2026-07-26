import type { WatchStatusKind } from "../storage/JenkinsWatchStore";

export type JobColorStatus =
  | "success"
  | "failed"
  | "unstable"
  | "aborted"
  | "notBuilt"
  | "disabled"
  | "running"
  | "unknown";

const JOB_COLOR_ANIMATION_SUFFIX = "_anime";

function stripJobColorAnimation(color: string): string {
  const lowerColor = color.toLowerCase();
  if (!lowerColor.endsWith(JOB_COLOR_ANIMATION_SUFFIX)) {
    return color;
  }
  return color.slice(0, color.length - JOB_COLOR_ANIMATION_SUFFIX.length);
}

function getBaseJobColor(color: string): string {
  return stripJobColorAnimation(color).toLowerCase();
}

export function isRunningJobColor(color?: string): boolean {
  return Boolean(color?.toLowerCase().endsWith(JOB_COLOR_ANIMATION_SUFFIX));
}

export function isJobColorDisabled(color?: string): boolean {
  if (!color) {
    return false;
  }
  const baseColor = getBaseJobColor(color);
  return baseColor === "disabled" || baseColor === "grey" || baseColor === "gray";
}

export function resolveJobColorStatus(color?: string): JobColorStatus | undefined {
  if (!color) {
    return undefined;
  }

  if (isRunningJobColor(color)) {
    return "running";
  }

  switch (getBaseJobColor(color)) {
    case "blue":
    case "green":
      return "success";
    case "red":
      return "failed";
    case "yellow":
      return "unstable";
    case "aborted":
      return "aborted";
    case "notbuilt":
      return "notBuilt";
    case "disabled":
    case "grey":
    case "gray":
      return "disabled";
    default:
      return "unknown";
  }
}

export function isFailingJobColor(color?: string): boolean {
  if (!color) {
    return false;
  }
  return getBaseJobColor(color) === "red";
}

export function resolveWatchStatusFromJobColor(color?: string): WatchStatusKind {
  const status = resolveJobColorStatus(color);
  if (!status) {
    return "unknown";
  }

  switch (status) {
    case "failed":
      return "failure";
    case "success":
      return "success";
    case "running":
    case "unstable":
    case "aborted":
    case "disabled":
    case "notBuilt":
      return "other";
    default:
      return "unknown";
  }
}

export function resolveJobColorIconId(status: JobColorStatus): string {
  switch (status) {
    case "success":
      return "check";
    case "failed":
      return "error";
    case "unstable":
      return "warning";
    case "aborted":
    case "disabled":
      return "circle-slash";
    case "notBuilt":
      return "circle-outline";
    default:
      return "symbol-misc";
  }
}

export function resolveJobColorCodicon(color?: string): string {
  const status = resolveJobColorStatus(color);
  if (status === "running") {
    return "sync~spin";
  }

  return status ? resolveJobColorIconId(status) : "symbol-misc";
}

export function resolveJobColorStatusBarThemeColorKey(color?: string): string | undefined {
  const status = resolveJobColorStatus(color);
  switch (status) {
    case "failed":
      return "statusBarItem.errorForeground";
    case "unstable":
      return "statusBarItem.warningForeground";
    case "aborted":
    case "disabled":
      return "statusBarItem.inactiveForeground";
    default:
      return undefined;
  }
}

export function formatJobColorStatusLabel(status: JobColorStatus): string {
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
      return "Unknown";
  }
}

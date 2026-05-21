import { formatDurationMs } from "./DurationFormatters";

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatOptionalLocaleTimestamp(timestamp?: number): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString();
}

export function formatOptionalDurationMs(duration?: number): string {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
    return "";
  }
  return formatDurationMs(duration);
}

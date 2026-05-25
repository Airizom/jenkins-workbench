import { formatDurationMs } from "./DurationFormatters";
import { formatRelativeTimestampMs } from "./RelativeTimeFormatters";

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatOptionalLocaleTimestamp(timestamp?: number): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString();
}

export function formatLocaleTimestampWithRelative(
  timestampMs: number,
  includeRelative: boolean
): string {
  const absolute =
    formatOptionalLocaleTimestamp(timestampMs) || new Date(timestampMs).toLocaleString();
  if (!includeRelative) {
    return absolute;
  }
  const relative = formatRelativeTimestampMs(timestampMs);
  return relative ? `${absolute} (${relative})` : absolute;
}

export function formatOptionalDurationMs(duration?: number): string {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
    return "";
  }
  return formatDurationMs(duration);
}

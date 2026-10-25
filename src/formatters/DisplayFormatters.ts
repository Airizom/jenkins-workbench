import { formatDurationMs } from "./DurationFormatters";
import { formatRelativeTimestampMs, LOCALE_TIMESTAMP_OPTIONS } from "./RelativeTimeFormatters";

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatOptionalLocaleTimestamp(timestamp?: number): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString(undefined, LOCALE_TIMESTAMP_OPTIONS);
}

export function formatLocaleTimestampWithRelative(
  timestampMs: number,
  includeRelative: boolean
): string {
  const absolute = formatOptionalLocaleTimestamp(timestampMs);
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

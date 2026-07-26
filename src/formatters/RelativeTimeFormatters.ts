const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function getAgeMs(timestampMs: number, now: number): number {
  return Math.max(0, now - timestampMs);
}

function formatRelativeMinutesAge(ageMs: number): string | undefined {
  if (ageMs < MINUTE_MS) {
    return "just now";
  }

  if (ageMs < HOUR_MS) {
    return `${Math.floor(ageMs / MINUTE_MS)}m ago`;
  }

  return undefined;
}

export function formatRelativeTimestampMs(timestampMs: number): string | undefined {
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  const ageMs = getAgeMs(timestampMs, Date.now());
  const minuteLabel = formatRelativeMinutesAge(ageMs);
  if (minuteLabel) {
    return minuteLabel;
  }

  if (ageMs < DAY_MS) {
    const hours = Math.floor(ageMs / HOUR_MS);
    return `${hours}h ago`;
  }

  const days = Math.floor(ageMs / DAY_MS);
  if (days === 1) {
    return "yesterday";
  }
  if (days < 7) {
    return `${days} days ago`;
  }

  return new Date(timestampMs).toLocaleDateString();
}

export function formatRelativeDate(date: Date | undefined, now: number): string {
  if (!date) {
    return "Unknown";
  }

  const timestampMs = date.getTime();
  if (!Number.isFinite(timestampMs) || !Number.isFinite(now)) {
    return "Unknown";
  }

  const ageMs = getAgeMs(timestampMs, now);
  if (ageMs < MINUTE_MS) {
    return "Just now";
  }

  const minutes = Math.round(ageMs / MINUTE_MS);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatRelativeIsoTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "unknown";
  }

  const ageMs = getAgeMs(parsed, Date.now());
  const minuteLabel = formatRelativeMinutesAge(ageMs);
  if (minuteLabel) {
    return minuteLabel;
  }

  return new Date(parsed).toLocaleTimeString();
}

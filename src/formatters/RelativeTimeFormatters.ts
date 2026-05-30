const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

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

  const now = Date.now();
  const elapsedMs = now - timestampMs;
  const diffMs = elapsedMs <= 0 ? 0 : elapsedMs;
  const minuteLabel = formatRelativeMinutesAge(diffMs);
  if (minuteLabel) {
    return minuteLabel;
  }

  if (diffMs < DAY_MS) {
    const hours = Math.floor(diffMs / HOUR_MS);
    return `${hours}h ago`;
  }

  const days = Math.floor(diffMs / DAY_MS);
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

  const deltaMs = Math.max(0, now - timestampMs);
  if (deltaMs < 15_000) {
    return "Just now";
  }

  const minutes = Math.round(deltaMs / MINUTE_MS);
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

  const elapsedMs = Date.now() - parsed;
  const ageMs = elapsedMs <= 0 ? 0 : elapsedMs;
  const minuteLabel = formatRelativeMinutesAge(ageMs);
  if (minuteLabel) {
    return minuteLabel;
  }

  return new Date(parsed).toLocaleTimeString();
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function formatRelativeTimestampMs(timestampMs: number): string | undefined {
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  const now = Date.now();
  const diffMs = Math.max(0, now - timestampMs);

  if (diffMs < MINUTE_MS) {
    return "just now";
  }

  if (diffMs < HOUR_MS) {
    const minutes = Math.floor(diffMs / MINUTE_MS);
    return `${minutes}m ago`;
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

  const deltaMs = Math.abs(now - date.getTime());
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

  const ageMs = Math.max(0, Date.now() - parsed);
  if (ageMs < MINUTE_MS) {
    return "just now";
  }

  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return new Date(parsed).toLocaleTimeString();
}

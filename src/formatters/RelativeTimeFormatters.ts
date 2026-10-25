const MINUTE_MS = 60_000;

// Medium date + short time ("Sep 26, 2026, 9:14 AM") keeps build timestamps compact and
// consistent across panels, tooltips, and pickers.
export const LOCALE_TIMESTAMP_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short"
};

interface RelativeTimeBucket {
  divisor: number;
  maxExclusive?: number;
  format: (value: number) => string;
}

interface RelativeTimePolicy {
  justNow: string;
  buckets: readonly RelativeTimeBucket[];
  fallback: (timestampMs: number) => string;
}

function formatElapsedTimestamp(
  timestampMs: number,
  now: number,
  policy: RelativeTimePolicy
): string {
  const ageMs = Math.max(0, now - timestampMs);
  if (ageMs < MINUTE_MS) {
    return policy.justNow;
  }

  let elapsed = ageMs;
  for (const bucket of policy.buckets) {
    elapsed = Math.floor(elapsed / bucket.divisor);
    if (bucket.maxExclusive === undefined || elapsed < bucket.maxExclusive) {
      return bucket.format(elapsed);
    }
  }

  return policy.fallback(timestampMs);
}

const MINUTE_AND_HOUR_BUCKETS: readonly RelativeTimeBucket[] = [
  { divisor: MINUTE_MS, maxExclusive: 60, format: (value) => `${value}m ago` },
  { divisor: 60, maxExclusive: 24, format: (value) => `${value}h ago` }
];

const TIMESTAMP_POLICY: RelativeTimePolicy = {
  justNow: "just now",
  buckets: [
    ...MINUTE_AND_HOUR_BUCKETS,
    {
      divisor: 24,
      maxExclusive: 7,
      format: (value) => (value === 1 ? "yesterday" : `${value} days ago`)
    }
  ],
  fallback: (timestampMs) => new Date(timestampMs).toLocaleDateString()
};

/**
 * Snapshot freshness for panel headers ("Updated 5m ago"). Past a day the
 * relative form stops being useful, so it falls back to the full date and time.
 */
const UPDATED_POLICY: RelativeTimePolicy = {
  justNow: "just now",
  buckets: MINUTE_AND_HOUR_BUCKETS,
  fallback: (timestampMs) =>
    new Date(timestampMs).toLocaleString(undefined, LOCALE_TIMESTAMP_OPTIONS)
};

export function formatRelativeTimestampMs(timestampMs: number): string | undefined {
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return formatElapsedTimestamp(timestampMs, Date.now(), TIMESTAMP_POLICY);
}

/**
 * "Updated just now", "Updated 5m ago", "Updated 3h ago", or "Updated <date,
 * time>" once older than a day. Shared by the Node Details and Node Capacity
 * headers so both panels describe freshness the same way.
 */
export function formatUpdatedAtLabel(value: Date | string | undefined, now: number): string {
  const timestampMs =
    value instanceof Date ? value.getTime() : value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestampMs) || !Number.isFinite(now)) {
    return "Update time unknown";
  }

  return `Updated ${formatElapsedTimestamp(timestampMs, now, UPDATED_POLICY)}`;
}

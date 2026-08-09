const MINUTE_MS = 60_000;

interface RelativeTimeBucket {
  divisor: number;
  rounding: "floor" | "round";
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
    elapsed =
      bucket.rounding === "floor"
        ? Math.floor(elapsed / bucket.divisor)
        : Math.round(elapsed / bucket.divisor);
    if (bucket.maxExclusive === undefined || elapsed < bucket.maxExclusive) {
      return bucket.format(elapsed);
    }
  }

  return policy.fallback(timestampMs);
}

const TIMESTAMP_POLICY: RelativeTimePolicy = {
  justNow: "just now",
  buckets: [
    { divisor: MINUTE_MS, rounding: "floor", maxExclusive: 60, format: (value) => `${value}m ago` },
    { divisor: 60, rounding: "floor", maxExclusive: 24, format: (value) => `${value}h ago` },
    {
      divisor: 24,
      rounding: "floor",
      maxExclusive: 7,
      format: (value) => (value === 1 ? "yesterday" : `${value} days ago`)
    }
  ],
  fallback: (timestampMs) => new Date(timestampMs).toLocaleDateString()
};

const DATE_POLICY: RelativeTimePolicy = {
  justNow: "Just now",
  buckets: [
    { divisor: MINUTE_MS, rounding: "round", maxExclusive: 60, format: (value) => `${value}m ago` },
    { divisor: 60, rounding: "round", maxExclusive: 48, format: (value) => `${value}h ago` },
    { divisor: 24, rounding: "round", format: (value) => `${value}d ago` }
  ],
  fallback: () => "Unknown"
};

const ISO_POLICY: RelativeTimePolicy = {
  justNow: "just now",
  buckets: [
    { divisor: MINUTE_MS, rounding: "floor", maxExclusive: 60, format: (value) => `${value}m ago` }
  ],
  fallback: (timestampMs) => new Date(timestampMs).toLocaleTimeString()
};

export function formatRelativeTimestampMs(timestampMs: number): string | undefined {
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return formatElapsedTimestamp(timestampMs, Date.now(), TIMESTAMP_POLICY);
}

export function formatRelativeDate(date: Date | undefined, now: number): string {
  if (!date) {
    return "Unknown";
  }

  const timestampMs = date.getTime();
  if (!Number.isFinite(timestampMs) || !Number.isFinite(now)) {
    return "Unknown";
  }

  return formatElapsedTimestamp(timestampMs, now, DATE_POLICY);
}

export function formatRelativeIsoTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "unknown";
  }

  return formatElapsedTimestamp(parsed, Date.now(), ISO_POLICY);
}

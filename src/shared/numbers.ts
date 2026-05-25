export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function pickFiniteNumber(primary?: number, fallback?: number): number | undefined {
  if (isFiniteNumber(primary)) {
    return primary;
  }
  if (isFiniteNumber(fallback)) {
    return fallback;
  }
  return undefined;
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.floor(value)));
}

export function toNonNegativeInteger(value: unknown): number {
  return isFiniteNumber(value) ? Math.max(0, Math.floor(value)) : 0;
}

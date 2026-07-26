import { trimToUndefined } from "./stringValues";

export function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function capListWithOverflow<T>(
  items: T[],
  limit: number
): { items: T[]; overflow: number } {
  if (items.length <= limit) {
    return { items, overflow: 0 };
  }
  return {
    items: items.slice(0, limit),
    overflow: Math.max(0, items.length - limit)
  };
}

export function uniqueNonEmptyStrings(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = trimToUndefined(value);
    if (trimmed === undefined || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

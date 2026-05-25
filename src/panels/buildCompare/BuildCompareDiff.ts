export function unionSortedMapKeys<T>(...maps: Array<Map<string, T>>): string[] {
  const keys = new Set<string>();
  for (const map of maps) {
    for (const key of map.keys()) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}

export interface KeyedDiffHandlers<T> {
  onAdded: (key: string, target: T) => void;
  onRemoved: (key: string, baseline: T) => void;
  onBoth: (key: string, baseline: T, target: T) => void;
}

export function forEachKeyedDiff<T>(
  baseline: Map<string, T>,
  target: Map<string, T>,
  handlers: KeyedDiffHandlers<T>
): void {
  for (const key of unionSortedMapKeys(baseline, target)) {
    const baselineValue = baseline.get(key);
    const targetValue = target.get(key);
    if (baselineValue === undefined && targetValue === undefined) {
      continue;
    }
    if (baselineValue === undefined && targetValue !== undefined) {
      handlers.onAdded(key, targetValue);
      continue;
    }
    if (baselineValue !== undefined && targetValue === undefined) {
      handlers.onRemoved(key, baselineValue);
      continue;
    }
    if (baselineValue !== undefined && targetValue !== undefined) {
      handlers.onBoth(key, baselineValue, targetValue);
    }
  }
}

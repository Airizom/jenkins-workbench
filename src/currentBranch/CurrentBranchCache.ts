export interface CachedValue<Value> {
  expiresAt: number;
  value: Value;
}

export function getFreshCachedValue<Value>(
  cache: Map<string, CachedValue<Value>>,
  key: string
): Value | undefined {
  const cached = cache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached.value : undefined;
}

export function setCachedValue<Value>(
  cache: Map<string, CachedValue<Value>>,
  key: string,
  value: Value,
  timeToLiveMs: number
): void {
  cache.set(key, {
    expiresAt: Date.now() + timeToLiveMs,
    value
  });
}

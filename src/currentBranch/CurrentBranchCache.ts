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

// Serves fresh cached values unless forced; otherwise fetches and caches the result only when
// no newer request for the same key started while the fetch was pending.
export async function resolveCachedLatest<Value>(
  cache: Map<string, CachedValue<Value>>,
  latestRequests: Map<string, number>,
  key: string,
  requestId: number,
  timeToLiveMs: number,
  force: boolean | undefined,
  fetch: () => Promise<Value>
): Promise<Value> {
  if (!force) {
    const cached = getFreshCachedValue(cache, key);
    if (cached) {
      return cached;
    }
  }

  latestRequests.set(key, Math.max(requestId, latestRequests.get(key) ?? 0));
  const value = await fetch();
  if (latestRequests.get(key) === requestId) {
    setCachedValue(cache, key, value, timeToLiveMs);
  }
  return value;
}

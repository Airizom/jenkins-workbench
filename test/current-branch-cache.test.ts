import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import {
  type CachedValue,
  getFreshCachedValue,
  resolveCachedLatest,
  setCachedValue
} from "../src/currentBranch/CurrentBranchCache";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CurrentBranchCache", () => {
  it("returns cached values only while their TTL is fresh", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cache = new Map<string, CachedValue<string>>();

    setCachedValue(cache, "branch", "main", 5_000);

    assert.equal(getFreshCachedValue(cache, "branch"), "main");
    vi.mocked(Date.now).mockReturnValue(6_000);
    assert.equal(getFreshCachedValue(cache, "branch"), undefined);
  });

  it("caches only the newest overlapping request when fetches resolve out of order", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cache = new Map<string, CachedValue<string>>();
    const latest = new Map<string, number>();
    const older = deferred<string>();
    const newer = deferred<string>();

    const first = resolveCachedLatest(cache, latest, "key", 1, 5_000, true, () => older.promise);
    const second = resolveCachedLatest(cache, latest, "key", 2, 5_000, true, () => newer.promise);
    newer.resolve("newer");
    assert.equal(await second, "newer");
    older.resolve("older");
    assert.equal(await first, "older");

    assert.equal(getFreshCachedValue(cache, "key"), "newer");
  });

  it("does not let an older request id reclaim the latest slot", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cache = new Map<string, CachedValue<string>>();
    const latest = new Map<string, number>();
    const newer = deferred<string>();

    const second = resolveCachedLatest(cache, latest, "key", 2, 5_000, true, () => newer.promise);
    assert.equal(
      await resolveCachedLatest(cache, latest, "key", 1, 5_000, true, async () => "older"),
      "older"
    );
    assert.equal(getFreshCachedValue(cache, "key"), undefined);
    newer.resolve("newer");
    await second;

    assert.equal(getFreshCachedValue(cache, "key"), "newer");
  });

  it("serves fresh cached values without fetching unless forced", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cache = new Map<string, CachedValue<string>>();
    const latest = new Map<string, number>();
    setCachedValue(cache, "key", "cached", 5_000);
    const load = vi.fn(async () => "fetched");

    assert.equal(await resolveCachedLatest(cache, latest, "key", 1, 5_000, false, load), "cached");
    assert.equal(load.mock.calls.length, 0);
    assert.equal(await resolveCachedLatest(cache, latest, "key", 2, 5_000, true, load), "fetched");
    assert.equal(getFreshCachedValue(cache, "key"), "fetched");
  });
});

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

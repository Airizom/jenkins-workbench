import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import {
  type CachedValue,
  getFreshCachedValue,
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
});

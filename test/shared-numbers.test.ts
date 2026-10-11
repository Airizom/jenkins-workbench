import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { clampPercent } from "../src/shared/numbers";

describe("clampPercent", () => {
  it("returns 0 for NaN input", () => {
    assert.equal(clampPercent(Number.NaN), 0);
    assert.equal(clampPercent(0 / 0), 0);
  });

  it("clamps out-of-range values into [0, 100]", () => {
    assert.equal(clampPercent(-5), 0);
    assert.equal(clampPercent(150), 100);
    assert.equal(clampPercent(Number.NEGATIVE_INFINITY), 0);
    assert.equal(clampPercent(Number.POSITIVE_INFINITY), 100);
  });

  it("floors in-range values", () => {
    assert.equal(clampPercent(42.9), 42);
    assert.equal(clampPercent(0), 0);
    assert.equal(clampPercent(100), 100);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { normalizeJobSearchOptions } from "../src/jenkins/data/JobSearchConfig";

describe("normalizeJobSearchOptions", () => {
  it("applies positive and non-negative integer bounds", () => {
    const normalized = normalizeJobSearchOptions({
      maxResults: -1.2,
      batchSize: 0,
      backoffBaseMs: -2.5,
      backoffMaxMs: -3.5
    });

    assert.equal(normalized.maxResults, 0);
    assert.equal(normalized.batchSize, 1);
    assert.equal(normalized.backoffBaseMs, 0);
    assert.equal(normalized.backoffMaxMs, 0);
  });

  it("normalizes legacy fractional and excessive concurrency and retry values", () => {
    const fractional = normalizeJobSearchOptions({ concurrency: 3.8, maxRetries: 2.9 });
    assert.equal(fractional.concurrency, 3);
    assert.equal(fractional.maxRetries, 2);

    const excessive = normalizeJobSearchOptions({ concurrency: 100_000, maxRetries: 100_000 });
    assert.equal(excessive.concurrency, 10);
    assert.equal(excessive.maxRetries, 10);
  });
});

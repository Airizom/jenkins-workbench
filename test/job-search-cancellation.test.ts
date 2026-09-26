import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AdaptiveBackoff } from "../src/jenkins/data/JobSearchBackoff";
import { waitWithCancellation } from "../src/jenkins/data/JobSearchCancellation";
import { CancellationError } from "../src/jenkins/errors";

describe("waitWithCancellation", () => {
  it("rejects a short wait when cancellation is already requested", async () => {
    await assert.rejects(
      waitWithCancellation(10, () => true),
      CancellationError
    );
  });

  it("rejects when cancellation is requested before a short timeout fires", async () => {
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 1);
    await assert.rejects(
      waitWithCancellation(20, () => cancelled),
      CancellationError
    );
  });

  it("resolves when cancellation is not requested", async () => {
    await waitWithCancellation(1, () => false);
  });
});

describe("AdaptiveBackoff.wait", () => {
  it("reports cancellation on the zero-delay path", async () => {
    const backoff = new AdaptiveBackoff({
      baseDelayMs: 0,
      minDelayMs: 0,
      maxDelayMs: 0,
      successDecay: 0.5,
      errorMultiplier: 2,
      jitterRatio: 0
    });
    await assert.rejects(backoff.wait({ isCancellationRequested: true }), CancellationError);
    await backoff.wait({ isCancellationRequested: false });
  });
});

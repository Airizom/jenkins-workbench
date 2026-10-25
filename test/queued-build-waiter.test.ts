import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { BuildActionError, JenkinsRequestError } from "../src/jenkins/errors";
import { QueuedBuildWaiter } from "../src/services/QueuedBuildWaiter";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const queueLocation = "https://jenkins.example/queue/item/42/";

function createWaiter(getQueueItem: ReturnType<typeof vi.fn>): QueuedBuildWaiter {
  return new QueuedBuildWaiter({ getQueueItem } as unknown as JenkinsDataService, {
    pollIntervalMs: 200,
    timeoutMs: 10_000
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("QueuedBuildWaiter", () => {
  it("keeps polling after a transient queue item error", async () => {
    vi.useFakeTimers();
    const getQueueItem = vi
      .fn()
      .mockRejectedValueOnce(new BuildActionError("Server error", "unknown", 503))
      .mockResolvedValueOnce({
        executable: { number: 1, url: "https://jenkins.example/job/a/1/" }
      });
    let resolved = false;
    const promise = createWaiter(getQueueItem)
      .awaitQueuedBuildStart(environment, queueLocation)
      .then(() => {
        resolved = true;
      });

    await vi.advanceTimersByTimeAsync(0);
    assert.equal(getQueueItem.mock.calls.length, 1);
    assert.equal(resolved, false);

    await vi.advanceTimersByTimeAsync(200);
    await promise;
    assert.equal(getQueueItem.mock.calls.length, 2);
    assert.deepEqual(getQueueItem.mock.calls[0], [environment, 42]);
  });

  it("stops waiting when the queue item is not found", async () => {
    const getQueueItem = vi
      .fn()
      .mockRejectedValue(new BuildActionError("Not found", "not_found", 404));
    await createWaiter(getQueueItem).awaitQueuedBuildStart(environment, queueLocation);
    assert.equal(getQueueItem.mock.calls.length, 1);
  });

  it("stops waiting on an authorization failure", async () => {
    const getQueueItem = vi
      .fn()
      .mockRejectedValue(new BuildActionError("Forbidden", "forbidden", 403));
    await createWaiter(getQueueItem).awaitQueuedBuildStart(environment, queueLocation);
    assert.equal(getQueueItem.mock.calls.length, 1);
  });

  it("gives up after repeated transient errors", async () => {
    vi.useFakeTimers();
    const getQueueItem = vi
      .fn()
      .mockRejectedValue(new BuildActionError("Server error", "unknown", 503));
    const promise = createWaiter(getQueueItem).awaitQueuedBuildStart(environment, queueLocation);

    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    assert.equal(getQueueItem.mock.calls.length, 3);
  });
});

describe("QueuedBuildWaiter.awaitQueuedBuild", () => {
  const options = { timeoutMs: 10_000, maxPollIntervalMs: 200 };

  it("reports the started build number and url", async () => {
    const getQueueItem = vi.fn().mockResolvedValue({
      executable: { number: 7, url: "https://jenkins.example/job/a/7/" }
    });
    const outcome = await createWaiter(getQueueItem).awaitQueuedBuild(
      environment,
      queueLocation,
      options
    );
    assert.deepEqual(outcome, {
      kind: "started",
      number: 7,
      url: "https://jenkins.example/job/a/7/"
    });
    assert.deepEqual(getQueueItem.mock.calls[0], [environment, 42]);
  });

  it("reports a cancelled queue item", async () => {
    const getQueueItem = vi.fn().mockResolvedValue({ cancelled: true });
    const outcome = await createWaiter(getQueueItem).awaitQueuedBuild(
      environment,
      queueLocation,
      options
    );
    assert.deepEqual(outcome, { kind: "cancelled" });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "returns unknown for an invalid executable number: %s",
    async (number) => {
      const getQueueItem = vi.fn().mockResolvedValue({ executable: { number } });
      const outcome = await createWaiter(getQueueItem).awaitQueuedBuild(
        environment,
        queueLocation,
        options
      );
      assert.deepEqual(outcome, { kind: "unknown" });
      assert.equal(getQueueItem.mock.calls.length, 1);
    }
  );

  it("returns unknown at once when the queue location has no item id", async () => {
    vi.useFakeTimers();
    const getQueueItem = vi.fn();
    const waiter = new QueuedBuildWaiter({ getQueueItem } as unknown as JenkinsDataService, {
      fallbackDelayMs: 4000
    });
    const outcome = await waiter.awaitQueuedBuild(
      environment,
      "https://jenkins.example/job/a/",
      options
    );
    assert.deepEqual(outcome, { kind: "unknown" });
    assert.deepEqual(await waiter.awaitQueuedBuild(environment, undefined, options), {
      kind: "unknown"
    });
    assert.equal(getQueueItem.mock.calls.length, 0);
  });

  it("returns unknown on a client error", async () => {
    const getQueueItem = vi.fn().mockRejectedValue(new JenkinsRequestError("Not found", 404));
    const outcome = await createWaiter(getQueueItem).awaitQueuedBuild(
      environment,
      queueLocation,
      options
    );
    assert.deepEqual(outcome, { kind: "unknown" });
    assert.equal(getQueueItem.mock.calls.length, 1);
  });

  it("returns unknown after three consecutive transient errors", async () => {
    vi.useFakeTimers();
    const getQueueItem = vi
      .fn()
      .mockRejectedValueOnce(new BuildActionError("Server error", "unknown", 503))
      .mockRejectedValueOnce(new BuildActionError("Server error", "unknown", 503))
      .mockResolvedValueOnce({})
      .mockRejectedValue(new BuildActionError("Server error", "unknown", 503));
    let outcome: unknown;
    const promise = createWaiter(getQueueItem)
      .awaitQueuedBuild(environment, queueLocation, options)
      .then((value) => {
        outcome = value;
      });

    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    assert.deepEqual(outcome, { kind: "unknown" });
    // The successful poll resets the count, so three more errors are needed.
    assert.equal(getQueueItem.mock.calls.length, 6);
  });

  it("backs off the poll interval up to the cap", async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];
    const start = Date.now();
    const getQueueItem = vi.fn(async () => {
      callTimes.push(Date.now() - start);
      return {};
    });
    const promise = createWaiter(getQueueItem).awaitQueuedBuild(environment, queueLocation, {
      timeoutMs: 60_000,
      maxPollIntervalMs: 500
    });

    await vi.advanceTimersByTimeAsync(2000);
    // Delays: 200, 300, 450, then capped at 500.
    assert.deepEqual(callTimes, [0, 200, 500, 950, 1450, 1950]);
    await vi.advanceTimersByTimeAsync(60_000);
    assert.deepEqual(await promise, { kind: "unknown" });
  });

  it("returns unknown when the deadline passes", async () => {
    vi.useFakeTimers();
    const getQueueItem = vi.fn().mockResolvedValue({});
    let outcome: unknown;
    const promise = createWaiter(getQueueItem)
      .awaitQueuedBuild(environment, queueLocation, { timeoutMs: 1000, maxPollIntervalMs: 200 })
      .then((value) => {
        outcome = value;
      });

    await vi.advanceTimersByTimeAsync(999);
    assert.equal(outcome, undefined);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    assert.deepEqual(outcome, { kind: "unknown" });
    assert.equal(getQueueItem.mock.calls.length, 5);
  });

  it("stops polling once the token is cancelled", async () => {
    vi.useFakeTimers();
    const token = { isCancellationRequested: false };
    const getQueueItem = vi.fn().mockResolvedValue({});
    const promise = createWaiter(getQueueItem).awaitQueuedBuild(environment, queueLocation, {
      ...options,
      token
    });

    await vi.advanceTimersByTimeAsync(0);
    assert.equal(getQueueItem.mock.calls.length, 1);
    token.isCancellationRequested = true;
    await vi.advanceTimersByTimeAsync(200);
    assert.deepEqual(await promise, { kind: "unknown" });
    assert.equal(getQueueItem.mock.calls.length, 1);
  });

  it("does not poll when the token is already cancelled", async () => {
    const getQueueItem = vi.fn();
    const outcome = await createWaiter(getQueueItem).awaitQueuedBuild(environment, queueLocation, {
      ...options,
      token: { isCancellationRequested: true }
    });
    assert.deepEqual(outcome, { kind: "unknown" });
    assert.equal(getQueueItem.mock.calls.length, 0);
  });
});

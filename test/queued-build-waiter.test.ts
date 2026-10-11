import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { BuildActionError } from "../src/jenkins/errors";
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

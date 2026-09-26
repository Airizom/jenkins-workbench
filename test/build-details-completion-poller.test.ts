import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import { BuildDetailsCompletionPoller } from "../src/panels/buildDetails/BuildDetailsCompletionPoller";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 250;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  assert.ok(predicate(), "timed out waiting for condition");
}

function buildDetails(): JenkinsBuildDetails {
  return {
    number: 1,
    url: "https://jenkins.example/job/example/1/",
    building: false
  };
}

describe("BuildDetailsCompletionPoller", () => {
  it("retries after a failed fetch without leaving a rejected poll", async () => {
    vi.useFakeTimers();
    let fetchCalls = 0;
    let shouldPoll = true;
    const updates: JenkinsBuildDetails[] = [];
    const poller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => 1,
      fetchBuildDetails: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          throw new Error("temporary failure");
        }
        return buildDetails();
      },
      isTokenCurrent: () => true,
      shouldPoll: () => shouldPoll,
      onDetailsUpdate: (details) => {
        updates.push(details);
        shouldPoll = false;
      }
    });

    try {
      poller.start(1);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(fetchCalls, 1);

      await vi.advanceTimersByTimeAsync(1);
      assert.equal(fetchCalls, 2);
      assert.deepEqual(updates, [buildDetails()]);
    } finally {
      poller.stop();
      vi.useRealTimers();
    }
  });

  it("can restart after a scheduled poll is skipped while polling is disabled", async () => {
    let shouldPoll = true;
    let fetchCalls = 0;
    const poller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => 1,
      fetchBuildDetails: async () => {
        fetchCalls += 1;
        return buildDetails();
      },
      isTokenCurrent: () => true,
      shouldPoll: () => shouldPoll,
      onDetailsUpdate: () => {
        shouldPoll = false;
      }
    });

    poller.start(1);
    shouldPoll = false;
    await delay(20);

    assert.equal(fetchCalls, 0);

    shouldPoll = true;
    poller.start(1);
    await waitFor(() => fetchCalls >= 1);
    poller.stop();

    assert.equal(fetchCalls, 1);
  });

  it("can restart after an in-flight fetch returns undefined while polling is disabled", async () => {
    vi.useFakeTimers();
    let shouldPoll = true;
    let fetchCalls = 0;
    let resolveFetch: ((details: JenkinsBuildDetails | undefined) => void) | undefined;
    const poller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => 1,
      fetchBuildDetails: () => {
        fetchCalls += 1;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
      isTokenCurrent: () => true,
      shouldPoll: () => shouldPoll,
      onDetailsUpdate: () => {}
    });

    try {
      poller.start(1);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(fetchCalls, 1);

      shouldPoll = false;
      resolveFetch?.(undefined);
      await Promise.resolve();

      shouldPoll = true;
      poller.start(1);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(fetchCalls, 2);
    } finally {
      poller.stop();
      vi.useRealTimers();
    }
  });
});

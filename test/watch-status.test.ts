import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsJob } from "../src/jenkins/types";
import { JenkinsJobStatusEvaluator } from "../src/watch/JenkinsJobStatusEvaluator";
import type { StatusNotifier } from "../src/watch/StatusNotifier";
import type { WatchedJobEntry } from "../src/storage/JenkinsWatchStore";
import { createEventEmitterVscodeMock } from "./helpers/vscodeMocks";

interface PollerConstructor {
  new (...args: unknown[]): unknown;
}
interface PollerHarness {
  poll(): Promise<void>;
  start(options?: { initialDelayMs?: number }): void;
  dispose(): void;
  updateMaxConsecutiveErrors(maxConsecutiveErrors: number): void;
  synchronizeWatchErrorCount(): void;
  onDidChangeWatchErrorCount(listener: (count: number) => void): { dispose(): void };
}

vi.doMock("vscode", () => createEventEmitterVscodeMock());
const { JenkinsStatusPoller } = (await import("../src/watch/JenkinsStatusPoller")) as unknown as {
  JenkinsStatusPoller: PollerConstructor;
};

interface NotifierCalls {
  failures: string[];
  recoveries: string[];
  watchErrors: string[];
  completions: unknown[];
  pendingInputs: unknown[];
}

function createNotifier(): StatusNotifier & { calls: NotifierCalls } {
  const calls: NotifierCalls = {
    failures: [],
    recoveries: [],
    watchErrors: [],
    completions: [],
    pendingInputs: []
  };

  return {
    calls,
    notifyFailure: (message) => calls.failures.push(message),
    notifyRecovery: (message) => calls.recoveries.push(message),
    notifyWatchError: (message) => calls.watchErrors.push(message),
    notifyCompletion: (notification) => calls.completions.push(notification),
    notifyPendingInput: (notification) => calls.pendingInputs.push(notification)
  };
}

function watchedEntry(overrides: Partial<WatchedJobEntry> = {}): WatchedJobEntry {
  return {
    scope: "workspace",
    environmentId: "env-1",
    jobUrl: "job/demo/",
    jobName: "demo",
    jobKind: "job",
    ...overrides
  };
}

describe("JenkinsJobStatusEvaluator", () => {
  it("seeds first-poll status fields without sending transition notifications", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const result = evaluator.evaluate(
      watchedEntry(),
      "demo",
      "blue",
      { number: 7, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.equal(result.nextStatus, "success");
    assert.equal(result.shouldUpdateStatus, true);
    assert.equal(result.shouldUpdateCompletion, true);
    assert.equal(result.shouldUpdateBuilding, true);
    assert.equal(result.notification, undefined);
  });

  it("returns failure and recovery intents while suppressing completion intents", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const failure = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 7, lastIsBuilding: false }),
      "demo",
      "red",
      { number: 8, result: "FAILURE" },
      "https://jenkins.example"
    );
    const recovery = evaluator.evaluate(
      watchedEntry({ lastStatus: "failure", lastCompletedBuildNumber: 8, lastIsBuilding: false }),
      "demo",
      "blue",
      { number: 9, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.deepEqual(failure.notification, {
      kind: "failure",
      message: "Job demo failed in https://jenkins.example."
    });
    assert.deepEqual(recovery.notification, {
      kind: "recovery",
      message: "Job demo recovered in https://jenkins.example."
    });
  });

  it("returns a completion intent when a completed build changes without failure or recovery", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const result = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 7, lastIsBuilding: true }),
      "demo",
      "blue",
      { number: 8, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.equal(result.shouldUpdateCompletion, true);
    assert.equal(result.shouldUpdateBuilding, true);
    assert.deepEqual(result.notification, {
      kind: "completion",
      details: {
        jobLabel: "Job demo",
        environmentUrl: "https://jenkins.example",
        result: "SUCCESS",
        color: "blue"
      }
    });
  });

  it("keeps a running observation from overwriting a stored terminal status", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const result = evaluator.evaluate(
      watchedEntry({ lastStatus: "failure", lastCompletedBuildNumber: 8, lastIsBuilding: false }),
      "demo",
      "red_anime",
      { number: 8, result: "FAILURE" },
      "https://jenkins.example"
    );

    assert.equal(result.nextStatus, "other");
    assert.equal(result.shouldUpdateStatus, false);
    assert.equal(result.shouldUpdateBuilding, true);
    assert.equal(result.notification, undefined);
  });

  it("returns recovery for failure -> other -> success", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const running = evaluator.evaluate(
      watchedEntry({ lastStatus: "failure", lastCompletedBuildNumber: 8, lastIsBuilding: false }),
      "demo",
      "red_anime",
      { number: 8, result: "FAILURE" },
      "https://jenkins.example"
    );
    // The running observation is not persisted, so the stored status stays "failure".
    assert.equal(running.shouldUpdateStatus, false);
    assert.equal(running.notification, undefined);
    const recovered = evaluator.evaluate(
      watchedEntry({ lastStatus: "failure", lastCompletedBuildNumber: 8, lastIsBuilding: true }),
      "demo",
      "blue",
      { number: 9, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.deepEqual(recovered.notification, {
      kind: "recovery",
      message: "Job demo recovered in https://jenkins.example."
    });
  });

  it("still returns failure for success -> other -> failure", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const running = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 8, lastIsBuilding: false }),
      "demo",
      "blue_anime",
      { number: 8, result: "SUCCESS" },
      "https://jenkins.example"
    );
    assert.equal(running.shouldUpdateStatus, false);
    assert.equal(running.notification, undefined);
    const failed = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 8, lastIsBuilding: true }),
      "demo",
      "red",
      { number: 9, result: "FAILURE" },
      "https://jenkins.example"
    );

    assert.deepEqual(failed.notification, {
      kind: "failure",
      message: "Job demo failed in https://jenkins.example."
    });
  });

  it("still seeds 'other' when no status was stored yet", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const result = evaluator.evaluate(
      watchedEntry(),
      "demo",
      "aborted",
      { number: 3, result: "ABORTED" },
      "https://jenkins.example"
    );

    assert.equal(result.nextStatus, "other");
    assert.equal(result.shouldUpdateStatus, true);
    assert.equal(result.notification, undefined);
  });

  it("keeps unknown colors from overwriting known status", () => {
    const evaluator = new JenkinsJobStatusEvaluator();

    const result = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 7, lastIsBuilding: false }),
      "demo",
      "mystery",
      { number: 7, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.equal(result.nextStatus, "unknown");
    assert.equal(result.shouldUpdateStatus, false);
    assert.equal(result.shouldUpdateCompletion, false);
    assert.equal(result.shouldUpdateBuilding, false);
    assert.equal(result.notification, undefined);
  });
});

describe("JenkinsStatusPoller", () => {
  it.each(["success", "missing", "error"] as const)(
    "discards a late %s response and queued ticks after disposal",
    async (outcome) => {
      const response = deferred<JenkinsJob>();
      const watched = [
        watchedEntry({ lastStatus: "success" }),
        watchedEntry({ jobUrl: "job/other/" }),
        watchedEntry({ environmentId: "removed-environment" })
      ];
      const listWatchedJobs = vi.fn(async () => watched);
      const getJob = vi.fn(() => response.promise);
      const updateWatchStatus = vi.fn(async () => undefined);
      const getPendingInputSummary = vi.fn(async () => ({
        awaitingInput: true,
        count: 1,
        signature: "input-a",
        fetchedAt: 1
      }));
      const fixture = createPollerFixture({
        listWatchedJobs,
        getJob,
        updateWatchStatus,
        getPendingInputSummary,
        maxConsecutiveErrors: 1
      });
      const errorCounts: number[] = [];
      fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));
      fixture.poller.start({ initialDelayMs: 60_000 });
      const poll = fixture.poller.poll();
      await vi.waitFor(() => assert.equal(getJob.mock.calls.length, 1));
      const removedEnvironments = [...fixture.watchStore.removedEnvironments];
      const hostRefreshes = fixture.hostRefreshes;
      fixture.fireTick();
      const listCallsBeforeDisposal = listWatchedJobs.mock.calls.length;
      fixture.poller.dispose();

      if (outcome === "success") {
        response.resolve({ ...runningJob(), color: "red" });
      } else {
        response.reject(
          outcome === "missing" ? new JenkinsRequestError("missing", 404) : new Error("network")
        );
      }
      await poll;
      // Even a retained tick callback or another start must not restart a disposed poller.
      fixture.fireTick();
      fixture.poller.start();
      await fixture.poller.poll();

      assert.equal(getJob.mock.calls.length, 1);
      assert.equal(listWatchedJobs.mock.calls.length, listCallsBeforeDisposal);
      assert.equal(getPendingInputSummary.mock.calls.length, 0);
      assert.equal(updateWatchStatus.mock.calls.length, 0);
      assert.deepEqual(fixture.watchStore.removedWatches, []);
      assert.deepEqual(fixture.watchStore.removedEnvironments, removedEnvironments);
      assert.deepEqual(errorCounts, []);
      assert.ok(Object.values(fixture.notifier.calls).every((calls) => calls.length === 0));
      assert.equal(fixture.hostRefreshes, hostRefreshes);
    }
  );

  it.each(["pending input", "watch update"] as const)(
    "stops after an in-flight %s completes following disposal",
    async (stage) => {
      const pending = deferred<void>();
      const updateWatchStatus = vi.fn(async () => {
        if (stage === "watch update") {
          await pending.promise;
        }
      });
      const getPendingInputSummary = vi.fn(async () => {
        if (stage === "pending input") {
          await pending.promise;
        }
        return { awaitingInput: stage === "pending input", count: 1, signature: "a", fetchedAt: 1 };
      });
      const getJob = vi.fn(async () => ({ ...runningJob(), color: "red" }));
      const fixture = createPollerFixture({
        watched: [watchedEntry({ lastStatus: "success" }), watchedEntry({ jobUrl: "job/other/" })],
        getJob,
        getPendingInputSummary,
        updateWatchStatus
      });
      const poll = fixture.poller.poll();
      await vi.waitFor(() =>
        assert.equal(
          (stage === "pending input" ? getPendingInputSummary : updateWatchStatus).mock.calls
            .length,
          1
        )
      );
      fixture.poller.dispose();
      pending.resolve();
      await poll;

      assert.equal(getJob.mock.calls.length, 1);
      assert.equal(updateWatchStatus.mock.calls.length, stage === "watch update" ? 1 : 0);
      assert.ok(Object.values(fixture.notifier.calls).every((calls) => calls.length === 0));
      assert.equal(fixture.hostRefreshes, 0);
    }
  );

  it("handles a watch-store failure on a tick and polls again on the next tick", async () => {
    let listAttempts = 0;
    const failure = new Error("watch store unavailable");
    const fixture = createPollerFixture({
      listWatchedJobs: async () => {
        listAttempts += 1;
        if (listAttempts === 2) {
          throw failure;
        }
        return [watchedEntry()];
      }
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      fixture.poller.start();
      await vi.waitFor(() => assert.equal(fixture.hostRefreshes, 1));

      fixture.fireTick();
      await vi.waitFor(() => assert.equal(warning.mock.calls.length, 1));
      assert.deepEqual(warning.mock.calls[0], ["Failed to poll watched Jenkins jobs.", failure]);

      fixture.fireTick();
      await vi.waitFor(() => assert.equal(fixture.hostRefreshes, 2));
      assert.equal(listAttempts, 3);
    } finally {
      warning.mockRestore();
    }
  });

  it("waits for the startup delay before the first poll unless a tick arrives first", async () => {
    vi.useFakeTimers();
    try {
      const getJob = vi.fn(async () => ({
        name: "demo",
        url: "job/demo/",
        color: "blue",
        lastCompletedBuild: { number: 1, result: "SUCCESS" }
      }));
      const delayed = createPollerFixture({ getJob });
      delayed.poller.start({ initialDelayMs: 5_000 });
      await vi.advanceTimersByTimeAsync(4_999);
      assert.equal(getJob.mock.calls.length, 0);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(getJob.mock.calls.length, 1);

      const ticked = createPollerFixture({ getJob });
      ticked.poller.start({ initialDelayMs: 5_000 });
      ticked.fireTick();
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(getJob.mock.calls.length, 2);

      const disposed = createPollerFixture({ getJob });
      disposed.poller.start({ initialDelayMs: 5_000 });
      disposed.poller.dispose();
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(getJob.mock.calls.length, 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls environments concurrently and each environment's jobs in order", async () => {
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const fixture = createPollerFixture({
      environments: [
        { id: "env-1", scope: "workspace", url: "https://slow.example" },
        { id: "env-2", scope: "workspace", url: "https://fast.example" }
      ],
      watched: [
        watchedEntry({ environmentId: "env-1", jobUrl: "job/a/" }),
        watchedEntry({ environmentId: "env-1", jobUrl: "job/b/" }),
        watchedEntry({ environmentId: "env-2", jobUrl: "job/c/" })
      ],
      getJob: (_environment, jobUrl) => {
        started.push(jobUrl);
        return new Promise((resolve) => {
          releases.set(jobUrl, () =>
            resolve({
              name: "demo",
              url: jobUrl,
              color: "blue",
              lastCompletedBuild: { number: 1, result: "SUCCESS" }
            })
          );
        });
      }
    });

    const poll = fixture.poller.poll();
    await vi.waitFor(() => assert.deepEqual(started, ["job/a/", "job/c/"]));
    releases.get("job/c/")?.();
    releases.get("job/a/")?.();
    await vi.waitFor(() => assert.deepEqual(started, ["job/a/", "job/c/", "job/b/"]));
    releases.get("job/b/")?.();
    await poll;
  });

  it("keeps polling and refreshing a healthy environment while another is stalled", async () => {
    const slowResponse = deferred<JenkinsJob>();
    const healthy = watchedEntry({
      scope: "global",
      jobUrl: "job/healthy/",
      lastStatus: "success",
      lastCompletedBuildNumber: 7,
      lastIsBuilding: false
    });
    const slow = watchedEntry({
      lastStatus: "success",
      lastCompletedBuildNumber: 7,
      lastIsBuilding: false
    });
    let healthyColor = "blue";
    const job = (jobUrl: string, color = "blue"): JenkinsJob => ({
      name: "demo",
      url: jobUrl,
      color,
      lastCompletedBuild: { number: 7, result: "SUCCESS" }
    });
    const getJob = vi.fn((_environment: unknown, jobUrl: string) =>
      jobUrl === slow.jobUrl ? slowResponse.promise : Promise.resolve(job(jobUrl, healthyColor))
    );
    const fixture = createPollerFixture({
      environments: [
        { id: "env-1", scope: "workspace", url: "https://slow.example" },
        { id: "env-1", scope: "global", url: "https://healthy.example" }
      ],
      listWatchedJobs: async () => [{ ...slow }, { ...healthy }],
      getJob,
      updateWatchStatus: async () => {
        healthy.lastStatus = healthyColor === "red" ? "failure" : "success";
      }
    });
    const callsFor = (jobUrl: string) =>
      getJob.mock.calls.filter(([, requestedUrl]) => requestedUrl === jobUrl).length;

    try {
      fixture.poller.start();
      await vi.waitFor(() => assert.equal(callsFor(healthy.jobUrl), 1));
      assert.equal(fixture.hostRefreshes, 0);

      healthyColor = "red";
      fixture.fireTick();
      await vi.waitFor(() => assert.equal(fixture.hostRefreshes, 1));
      // Only the environment whose watched job changed is refreshed.
      assert.deepEqual(fixture.refreshedEnvironmentIds, ["env-1"]);
      assert.equal(callsFor(healthy.jobUrl), 2);
      assert.equal(callsFor(slow.jobUrl), 1);
      assert.equal(fixture.notifier.calls.failures.length, 1);

      fixture.fireTick();
      await vi.waitFor(() => assert.equal(callsFor(healthy.jobUrl), 3));
      assert.equal(callsFor(slow.jobUrl), 1);

      slowResponse.resolve(job(slow.jobUrl));
      await vi.waitFor(() => assert.equal(callsFor(slow.jobUrl), 2));
      await fixture.poller.poll();
      assert.equal(fixture.hostRefreshes, 1);
      assert.equal(fixture.notifier.calls.failures.length, 1);
    } finally {
      fixture.poller.dispose();
      slowResponse.resolve(job(slow.jobUrl));
    }
  });

  it("coalesces queued ticks and reloads persisted status before polling again", async () => {
    const response = deferred<JenkinsJob>();
    const entry = watchedEntry({
      lastStatus: "success",
      lastCompletedBuildNumber: 7,
      lastIsBuilding: false
    });
    const getJob = vi.fn(() => response.promise);
    const listWatchedJobs = vi.fn(async () => [{ ...entry }]);
    const fixture = createPollerFixture({
      listWatchedJobs,
      getJob,
      updateWatchStatus: async () => {
        entry.lastStatus = "failure";
      }
    });

    try {
      fixture.poller.start({ initialDelayMs: 60_000 });
      const poll = fixture.poller.poll();
      await vi.waitFor(() => assert.equal(getJob.mock.calls.length, 1));
      const queuedPoll = fixture.poller.poll();
      await vi.waitFor(() => assert.equal(listWatchedJobs.mock.calls.length, 2));
      const nextPoll = fixture.poller.poll();
      await vi.waitFor(() => assert.equal(listWatchedJobs.mock.calls.length, 3));
      assert.equal(getJob.mock.calls.length, 1);

      response.resolve({
        name: "demo",
        url: entry.jobUrl,
        color: "red",
        lastCompletedBuild: { number: 7, result: "FAILURE" }
      });
      await Promise.all([poll, queuedPoll, nextPoll]);

      assert.equal(getJob.mock.calls.length, 2);
      assert.equal(fixture.notifier.calls.failures.length, 1);
      assert.equal(fixture.hostRefreshes, 1);
    } finally {
      fixture.poller.dispose();
    }
  });

  it("sends a failure notification only after the watch update succeeds", async () => {
    const entry = watchedEntry({
      lastStatus: "success",
      lastCompletedBuildNumber: 7,
      lastIsBuilding: false
    });
    let updateAttempts = 0;
    const fixture = createPollerFixture({
      watched: [entry],
      getJob: async () => ({
        name: "demo",
        url: "job/demo/",
        color: "red",
        lastCompletedBuild: { number: 8, result: "FAILURE" }
      }),
      updateWatchStatus: async () => {
        updateAttempts += 1;
        assert.deepEqual(fixture.notifier.calls.failures, []);
        if (updateAttempts === 1) {
          throw new Error("persistence failed");
        }
        entry.lastStatus = "failure";
        entry.lastCompletedBuildNumber = 8;
      }
    });

    await fixture.poller.poll();
    assert.deepEqual(fixture.notifier.calls.failures, []);

    await fixture.poller.poll();
    await fixture.poller.poll();

    assert.equal(updateAttempts, 2);
    assert.deepEqual(fixture.notifier.calls.failures, [
      "Job demo failed in https://jenkins.example."
    ]);
    assert.deepEqual(fixture.notifier.calls.completions, []);
  });

  it("persists and refreshes when only the job name changes", async () => {
    const updateWatchStatus = vi.fn(async () => undefined);
    const fixture = createPollerFixture({
      watched: [
        watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 1, lastIsBuilding: false })
      ],
      getJob: async () => ({
        name: "renamed",
        url: "job/demo/",
        color: "blue",
        lastCompletedBuild: { number: 1, result: "SUCCESS" }
      }),
      updateWatchStatus
    });

    await fixture.poller.poll();

    assert.equal(updateWatchStatus.mock.calls.length, 1);
    assert.deepEqual(fixture.refreshedEnvironmentIds, ["env-1"]);
  });

  it("removes watches for stale environments and triggers a refresh", async () => {
    const fixture = createPollerFixture({
      environments: [],
      watched: [watchedEntry()]
    });

    await fixture.poller.poll();

    assert.deepEqual(fixture.watchStore.removedEnvironments, [
      { scope: "workspace", environmentId: "env-1" }
    ]);
    assert.equal(fixture.hostRefreshes, 1);
  });

  it("removes a watched job immediately when Jenkins reports 404", async () => {
    const fixture = createPollerFixture({
      getJob: async () => {
        throw new JenkinsRequestError("missing", 404);
      }
    });

    await fixture.poller.poll();

    assert.deepEqual(fixture.watchStore.removedWatches, [
      { scope: "workspace", environmentId: "env-1", jobUrl: "job/demo/" }
    ]);
    assert.equal(fixture.notifier.calls.watchErrors.length, 1);
    assert.equal(fixture.hostRefreshes, 1);
  });

  it("warns once after the non-404 polling error threshold and clears after recovery", async () => {
    const fixture = createPollerFixture({
      maxConsecutiveErrors: 2,
      getJob: async () => {
        throw new Error("network");
      }
    });
    const errorCounts: number[] = [];
    fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));

    await fixture.poller.poll();
    await fixture.poller.poll();
    await fixture.poller.poll();

    assert.equal(fixture.notifier.calls.watchErrors.length, 1);
    assert.deepEqual(errorCounts, [1]);

    fixture.getJob = async () => ({
      name: "demo",
      url: "job/demo/",
      color: "blue",
      lastCompletedBuild: { number: 2, result: "SUCCESS" }
    });

    await fixture.poller.poll();

    assert.deepEqual(errorCounts, [1, 0]);
  });

  it.each([0, 1, 2, 3])(
    "skips redundant error-count synchronization after recovering from %i failures",
    async (failures) => {
      const fixture = createPollerFixture({
        maxConsecutiveErrors: 2,
        getJob: async () => {
          throw new Error("network");
        }
      });
      const errorCounts: number[] = [];
      fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));
      for (let attempt = 0; attempt < failures; attempt += 1) {
        await fixture.poller.poll();
      }

      fixture.getJob = async () => ({ name: "demo", url: "job/demo/", color: "blue" });
      const synchronize = vi.spyOn(fixture.poller, "synchronizeWatchErrorCount");
      try {
        await fixture.poller.poll();
        // Pruning synchronizes once per poll; recovery only needs another scan at the threshold.
        assert.equal(synchronize.mock.calls.length, failures >= 2 ? 2 : 1);
        assert.deepEqual(errorCounts, failures >= 2 ? [1, 0] : []);

        synchronize.mockClear();
        await fixture.poller.poll();
        await fixture.poller.poll();
        assert.equal(synchronize.mock.calls.length, 2);
      } finally {
        synchronize.mockRestore();
      }
    }
  );

  it("updates the derived error count once when watches are pruned or cleared", async () => {
    const watched = [watchedEntry(), watchedEntry({ jobUrl: "job/other/", jobName: "other" })];
    const fixture = createPollerFixture({
      watched,
      maxConsecutiveErrors: 1,
      getJob: async () => {
        throw new Error("network");
      }
    });
    const errorCounts: number[] = [];
    fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));

    await fixture.poller.poll();
    watched.splice(0, 1);
    await fixture.poller.poll();
    watched.splice(0, 1);
    await fixture.poller.poll();

    assert.deepEqual(errorCounts, [1, 2, 1, 0]);
  });

  it("updates the derived error count once when an errored watch is removed", async () => {
    const fixture = createPollerFixture({
      maxConsecutiveErrors: 1,
      getJob: async () => {
        throw new Error("network");
      }
    });
    const errorCounts: number[] = [];
    fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));

    await fixture.poller.poll();
    fixture.getJob = async () => {
      throw new JenkinsRequestError("missing", 404);
    };
    await fixture.poller.poll();

    assert.deepEqual(errorCounts, [1, 0]);
  });

  it("updates the derived error count once when an environment is removed", async () => {
    const environments = [
      { id: "env-1", scope: "workspace" as const, url: "https://jenkins.example" }
    ];
    const fixture = createPollerFixture({
      environments,
      maxConsecutiveErrors: 1,
      getJob: async () => {
        throw new Error("network");
      }
    });
    const errorCounts: number[] = [];
    fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));

    await fixture.poller.poll();
    environments.splice(0, 1);
    await fixture.poller.poll();

    assert.deepEqual(errorCounts, [1, 0]);
  });

  it("resets failure counts and emits only effective changes when the threshold changes", async () => {
    const fixture = createPollerFixture({
      maxConsecutiveErrors: 1,
      getJob: async () => {
        throw new Error("network");
      }
    });
    const errorCounts: number[] = [];
    fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));

    await fixture.poller.poll();
    fixture.poller.updateMaxConsecutiveErrors(2);
    fixture.poller.updateMaxConsecutiveErrors(2);
    await fixture.poller.poll();
    await fixture.poller.poll();

    assert.deepEqual(errorCounts, [1, 0, 1]);
    assert.equal(fixture.notifier.calls.watchErrors.length, 2);
  });

  it("deduplicates pending input notifications by build signature", async () => {
    const fixtureSignature = "input-a";
    const fixture = createPollerFixture({
      getJob: async () => runningJob(),
      getPendingInputSummary: async () => ({
        awaitingInput: true,
        count: 1,
        signature: fixtureSignature,
        message: "Approve deploy",
        fetchedAt: 1
      })
    });

    await fixture.poller.poll();
    await fixture.poller.poll();
    fixture.getPendingInputSummary = async () => ({
      awaitingInput: true,
      count: 2,
      signature: "input-b",
      message: "Approve release",
      fetchedAt: 2
    });
    await fixture.poller.poll();

    assert.equal(fixture.notifier.calls.pendingInputs.length, 2);
  });

  it("retains only the current build pending input identity", async () => {
    let buildNumber = 8;
    const fixture = createPollerFixture({
      getJob: async () => ({
        ...runningJob(),
        lastBuild: {
          number: buildNumber,
          url: `job/demo/${buildNumber}/`,
          building: true
        }
      }),
      getPendingInputSummary: async (_environment, buildUrl) => ({
        awaitingInput: true,
        count: 1,
        signature: `input-${buildUrl}`,
        fetchedAt: 1
      })
    });

    await fixture.poller.poll();
    buildNumber = 9;
    await fixture.poller.poll();
    buildNumber = 10;
    await fixture.poller.poll();
    await fixture.poller.poll();
    buildNumber = 8;
    await fixture.poller.poll();

    assert.deepEqual(
      fixture.notifier.calls.pendingInputs.map(
        (notification) => (notification as { buildUrl: string }).buildUrl
      ),
      ["job/demo/8/", "job/demo/9/", "job/demo/10/", "job/demo/8/"]
    );
  });

  it("clears the pending input identity when a watched job is removed", async () => {
    const removedJob = watchedEntry();
    const activeJob = watchedEntry({ jobUrl: "job/other/", jobName: "other" });
    const watched = [removedJob, activeJob];
    const fixture = createPollerFixture({
      watched,
      getJob: async (_environment, jobUrl) => runningJob(jobUrl),
      getPendingInputSummary: async () => ({
        awaitingInput: true,
        count: 1,
        signature: "input-a",
        message: "Approve deploy",
        fetchedAt: 1
      })
    });

    await fixture.poller.poll();
    watched.splice(0, 1);
    await fixture.poller.poll();
    watched.unshift(removedJob);
    await fixture.poller.poll();

    assert.equal(fixture.notifier.calls.pendingInputs.length, 3);
  });

  it("keeps notifications and error counts stable across a complete watch lifecycle", async () => {
    const entry = watchedEntry();
    const watched = [entry];
    let buildUrl = "job/demo/8/";
    const fixture = createPollerFixture({
      watched,
      maxConsecutiveErrors: 2,
      getJob: async () => {
        throw new Error("network");
      },
      getPendingInputSummary: async () => ({
        awaitingInput: true,
        count: 1,
        signature: "input-a",
        fetchedAt: 1
      })
    });
    const errorCounts: number[] = [];
    fixture.poller.onDidChangeWatchErrorCount((count) => errorCounts.push(count));

    await fixture.poller.poll();
    await fixture.poller.poll();
    await fixture.poller.poll();

    fixture.getJob = async () => ({
      ...runningJob(),
      lastBuild: { number: 8, url: buildUrl, building: true }
    });
    await fixture.poller.poll();
    buildUrl = "job/demo/9/";
    await fixture.poller.poll();

    watched.splice(0, 1);
    await fixture.poller.poll();
    watched.push(entry);
    await fixture.poller.poll();

    assert.equal(fixture.notifier.calls.watchErrors.length, 1);
    assert.deepEqual(errorCounts, [1, 0]);
    assert.equal(fixture.notifier.calls.pendingInputs.length, 3);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runningJob(jobUrl = "job/demo/"): JenkinsJob {
  const name = jobUrl.includes("other") ? "other" : "demo";
  return {
    name,
    url: jobUrl,
    color: "blue_anime",
    lastBuild: { number: 8, url: `${jobUrl}8/`, building: true },
    lastCompletedBuild: { number: 7, result: "SUCCESS" }
  };
}

interface PollerFixtureOptions {
  environments?: Array<{
    id: string;
    scope: "workspace" | "global";
    url: string;
    username?: string;
  }>;
  watched?: WatchedJobEntry[];
  listWatchedJobs?: () => Promise<WatchedJobEntry[]>;
  getJob?: (environment: unknown, jobUrl: string) => Promise<JenkinsJob>;
  getPendingInputSummary?: (
    environment: unknown,
    buildUrl: string
  ) => Promise<{
    awaitingInput: boolean;
    count: number;
    signature?: string;
    message?: string;
    fetchedAt: number;
  }>;
  maxConsecutiveErrors?: number;
  updateWatchStatus?: () => Promise<void>;
}

function createPollerFixture(options: PollerFixtureOptions = {}): {
  poller: PollerHarness;
  fireTick(): void;
  notifier: StatusNotifier & { calls: NotifierCalls };
  watchStore: {
    removedEnvironments: Array<{ scope: string; environmentId: string }>;
    removedWatches: Array<{ scope: string; environmentId: string; jobUrl: string }>;
  };
  getJob: (environment: unknown, jobUrl: string) => Promise<JenkinsJob>;
  getPendingInputSummary: (
    environment: unknown,
    buildUrl: string
  ) => Promise<{
    awaitingInput: boolean;
    count: number;
    signature?: string;
    message?: string;
    fetchedAt: number;
  }>;
  hostRefreshes: number;
  refreshedEnvironmentIds: Array<string | undefined>;
} {
  const notifier = createNotifier();
  let tick: (() => void) | undefined;
  const watchStore = {
    removedEnvironments: [] as Array<{ scope: string; environmentId: string }>,
    removedWatches: [] as Array<{ scope: string; environmentId: string; jobUrl: string }>,
    listWatchedJobs: options.listWatchedJobs ?? (async () => options.watched ?? [watchedEntry()]),
    removeWatchesForEnvironment: async (scope: string, environmentId: string) => {
      watchStore.removedEnvironments.push({ scope, environmentId });
    },
    removeWatch: async (scope: string, environmentId: string, jobUrl: string) => {
      watchStore.removedWatches.push({ scope, environmentId, jobUrl });
      return true;
    },
    updateWatchStatus: options.updateWatchStatus ?? (async () => undefined)
  };
  const fixture = {
    poller: undefined as unknown as PollerHarness,
    fireTick: () => {
      if (!tick) {
        throw new Error("Poller has not started");
      }
      tick();
    },
    notifier,
    watchStore,
    getJob:
      options.getJob ??
      (async () => ({
        name: "demo",
        url: "job/demo/",
        color: "blue",
        lastCompletedBuild: { number: 1, result: "SUCCESS" }
      })),
    getPendingInputSummary:
      options.getPendingInputSummary ??
      (async () => ({
        awaitingInput: false,
        count: 0,
        fetchedAt: 1
      })),
    hostRefreshes: 0,
    refreshedEnvironmentIds: [] as Array<string | undefined>
  };
  const store = {
    listEnvironmentsWithScope: async () =>
      options.environments ?? [
        { id: "env-1", scope: "workspace" as const, url: "https://jenkins.example" }
      ]
  };
  const dataService = {
    getJob: (environment: unknown, jobUrl: string) => fixture.getJob(environment, jobUrl)
  };
  const statusRefreshService = {
    onDidTick: (listener: () => void) => {
      tick = listener;
      return { dispose: () => undefined };
    },
    getRefreshIntervalMs: () => 1000
  };
  const pendingInputCoordinator = {
    getSummary: (environment: unknown, buildUrl: string) =>
      fixture.getPendingInputSummary(environment, buildUrl)
  };
  const host = {
    fullEnvironmentRefresh: (environmentId?: string) => {
      fixture.hostRefreshes += 1;
      fixture.refreshedEnvironmentIds.push(environmentId);
    }
  };

  fixture.poller = new JenkinsStatusPoller(
    store,
    dataService,
    statusRefreshService,
    pendingInputCoordinator,
    watchStore,
    notifier,
    host,
    options.maxConsecutiveErrors
  ) as PollerHarness;

  return fixture;
}

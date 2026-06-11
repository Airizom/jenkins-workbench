import assert from "node:assert/strict";
import Module = require("node:module");
import { describe, it } from "node:test";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsJob } from "../src/jenkins/types";
import { JenkinsJobStatusEvaluator } from "../src/watch/JenkinsJobStatusEvaluator";
import type { StatusNotifier } from "../src/watch/StatusNotifier";
import type { WatchedJobEntry } from "../src/storage/JenkinsWatchStore";

interface PollerConstructor {
  new (...args: unknown[]): unknown;
}
interface PollerHarness {
  poll(): Promise<void>;
  onDidChangeWatchErrorCount(listener: (count: number) => void): { dispose(): void };
}
type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;

class TestEventEmitter<T> {
  private readonly listeners = new Set<(event: T) => void>();

  readonly event = (listener: (event: T) => void): { dispose(): void } => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => {
  if (request === "vscode") {
    return { EventEmitter: TestEventEmitter };
  }
  return originalLoad(request, parent, isMain);
};

const { JenkinsStatusPoller } = require("../src/watch/JenkinsStatusPoller") as {
  JenkinsStatusPoller: PollerConstructor;
};

moduleWithLoad._load = originalLoad;

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
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

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
    assert.equal(result.shouldRefresh, true);
    assert.deepEqual(notifier.calls.failures, []);
    assert.deepEqual(notifier.calls.recoveries, []);
    assert.deepEqual(notifier.calls.completions, []);
  });

  it("notifies failures and recoveries while suppressing duplicate completion notifications", () => {
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

    evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 7, lastIsBuilding: false }),
      "demo",
      "red",
      { number: 8, result: "FAILURE" },
      "https://jenkins.example"
    );
    evaluator.evaluate(
      watchedEntry({ lastStatus: "failure", lastCompletedBuildNumber: 8, lastIsBuilding: false }),
      "demo",
      "blue",
      { number: 9, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.deepEqual(notifier.calls.failures, ["Job demo failed in https://jenkins.example."]);
    assert.deepEqual(notifier.calls.recoveries, ["Job demo recovered in https://jenkins.example."]);
    assert.deepEqual(notifier.calls.completions, []);
  });

  it("notifies completion when a completed build changes without failure or recovery", () => {
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

    const result = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 7, lastIsBuilding: true }),
      "demo",
      "blue",
      { number: 8, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.equal(result.shouldUpdateCompletion, true);
    assert.equal(result.shouldUpdateBuilding, true);
    assert.deepEqual(notifier.calls.completions, [
      {
        jobLabel: "Job demo",
        environmentUrl: "https://jenkins.example",
        result: "SUCCESS",
        color: "blue"
      }
    ]);
  });

  it("keeps a running observation from overwriting a stored terminal status", () => {
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

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
    assert.deepEqual(notifier.calls.failures, []);
    assert.deepEqual(notifier.calls.recoveries, []);
  });

  it("notifies recovery for failure -> other -> success", () => {
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

    const running = evaluator.evaluate(
      watchedEntry({ lastStatus: "failure", lastCompletedBuildNumber: 8, lastIsBuilding: false }),
      "demo",
      "red_anime",
      { number: 8, result: "FAILURE" },
      "https://jenkins.example"
    );
    // The running observation is not persisted, so the stored status stays "failure".
    assert.equal(running.shouldUpdateStatus, false);
    evaluator.evaluate(
      watchedEntry({ lastStatus: "failure", lastCompletedBuildNumber: 8, lastIsBuilding: true }),
      "demo",
      "blue",
      { number: 9, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.deepEqual(notifier.calls.failures, []);
    assert.deepEqual(notifier.calls.recoveries, ["Job demo recovered in https://jenkins.example."]);
    assert.deepEqual(notifier.calls.completions, []);
  });

  it("still notifies failure for success -> other -> failure", () => {
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

    const running = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 8, lastIsBuilding: false }),
      "demo",
      "blue_anime",
      { number: 8, result: "SUCCESS" },
      "https://jenkins.example"
    );
    assert.equal(running.shouldUpdateStatus, false);
    evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 8, lastIsBuilding: true }),
      "demo",
      "red",
      { number: 9, result: "FAILURE" },
      "https://jenkins.example"
    );

    assert.deepEqual(notifier.calls.failures, ["Job demo failed in https://jenkins.example."]);
    assert.deepEqual(notifier.calls.recoveries, []);
    assert.deepEqual(notifier.calls.completions, []);
  });

  it("still seeds 'other' when no status was stored yet", () => {
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

    const result = evaluator.evaluate(
      watchedEntry(),
      "demo",
      "aborted",
      { number: 3, result: "ABORTED" },
      "https://jenkins.example"
    );

    assert.equal(result.nextStatus, "other");
    assert.equal(result.shouldUpdateStatus, true);
    assert.deepEqual(notifier.calls.failures, []);
    assert.deepEqual(notifier.calls.recoveries, []);
  });

  it("keeps unknown colors from overwriting known status", () => {
    const notifier = createNotifier();
    const evaluator = new JenkinsJobStatusEvaluator(notifier);

    const result = evaluator.evaluate(
      watchedEntry({ lastStatus: "success", lastCompletedBuildNumber: 7, lastIsBuilding: false }),
      "demo",
      "mystery",
      { number: 7, result: "SUCCESS" },
      "https://jenkins.example"
    );

    assert.equal(result.nextStatus, "unknown");
    assert.equal(result.shouldUpdateStatus, false);
    assert.equal(result.shouldRefresh, false);
    assert.deepEqual(notifier.calls, {
      failures: [],
      recoveries: [],
      watchErrors: [],
      completions: [],
      pendingInputs: []
    });
  });
});

describe("JenkinsStatusPoller", () => {
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
});

function runningJob(): JenkinsJob {
  return {
    name: "demo",
    url: "job/demo/",
    color: "blue_anime",
    lastBuild: { number: 8, url: "job/demo/8/", building: true },
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
}

function createPollerFixture(options: PollerFixtureOptions = {}): {
  poller: PollerHarness;
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
} {
  const notifier = createNotifier();
  const watchStore = {
    removedEnvironments: [] as Array<{ scope: string; environmentId: string }>,
    removedWatches: [] as Array<{ scope: string; environmentId: string; jobUrl: string }>,
    listWatchedJobs: async () => options.watched ?? [watchedEntry()],
    removeWatchesForEnvironment: async (scope: string, environmentId: string) => {
      watchStore.removedEnvironments.push({ scope, environmentId });
    },
    removeWatch: async (scope: string, environmentId: string, jobUrl: string) => {
      watchStore.removedWatches.push({ scope, environmentId, jobUrl });
      return true;
    },
    updateWatchStatus: async () => undefined
  };
  const fixture = {
    poller: undefined as unknown as PollerHarness,
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
    hostRefreshes: 0
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
    onDidTick: () => ({ dispose: () => undefined }),
    getRefreshIntervalMs: () => 1000
  };
  const pendingInputCoordinator = {
    getSummary: (environment: unknown, buildUrl: string) =>
      fixture.getPendingInputSummary(environment, buildUrl)
  };
  const host = {
    fullEnvironmentRefresh: () => {
      fixture.hostRefreshes += 1;
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

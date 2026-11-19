import { QueuedBuildWaiter, type QueuedBuildOutcome } from "../src/services/QueuedBuildWaiter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JenkinsBuildDetails, JenkinsQueueItem } from "../src/jenkins/types";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  CauseTriggeredBuildOrigin,
  FollowBuildResult,
  FollowedBuild,
  FollowedBuildCompletion,
  TriggeredBuildLocation,
  TriggeredBuildOrigin
} from "../src/services/buildFollow/BuildFollowTypes";
import type {
  AnnounceAndFollowOptions,
  BuildFollowUpDependencies,
  CauseFollowRequest,
  PreparedFollow,
  QueueFollowRequest
} from "../src/services/buildFollow/BuildFollowUpService";
import { TriggeredBuildLocator } from "../src/services/buildFollow/TriggeredBuildLocator";
import { StartedBuildCompletionWatch } from "../src/services/buildFollow/StartedBuildCompletionWatch";
import * as vscodeStub from "./helpers/vscodeStub";

const showInformationMessage = vi.fn(
  async (_message: string, ..._items: string[]): Promise<string | undefined> => undefined
);
const showErrorMessage = vi.fn(async (_message: string) => undefined);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  StatusBarAlignment: { Left: 1 },
  window: {
    showInformationMessage,
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage,
    createStatusBarItem: () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() })
  }
}));

const { BuildCompletionTracker } = await import(
  "../src/services/buildFollow/BuildCompletionTracker"
);
const { BuildFollowUpService } = await import("../src/services/buildFollow/BuildFollowUpService");

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const jobUrl = "https://jenkins.example/job/folder/job/demo/";
const sourceBuildUrl = `${jobUrl}12/`;
const queueLocation = "https://jenkins.example/queue/item/42/";
const buildLocation = `${jobUrl}13/`;

const queueRequest: QueueFollowRequest = {
  kind: "queue",
  environment,
  jobUrl,
  label: "folder/demo"
};
const causeRequest: CauseFollowRequest = {
  kind: "cause",
  environment,
  sourceBuildUrl,
  cause: "rebuild"
};
const causeOrigin: CauseTriggeredBuildOrigin = {
  kind: "cause",
  environment,
  jobUrl,
  label: "folder/demo",
  firstCandidateNumber: 13,
  sourceBuildNumber: 12,
  cause: "rebuild"
};
const preparedQueue: PreparedFollow = { request: queueRequest };
const preparedCause: PreparedFollow = { request: causeRequest, causeOrigin };

const startedBuild: FollowedBuild = {
  environment,
  buildUrl: buildLocation,
  buildNumber: 13,
  label: "folder/demo #13"
};
const started: TriggeredBuildLocation = { kind: "started", ...startedBuild };

const ACTIONS = ["View Build Details", "Preview Log", "Notify When Finished"] as const;
const TRIGGERED = "Triggered build for folder/demo";
const WAITING = `${TRIGGERED}. Waiting for it to start…`;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Token = { readonly isCancellationRequested: boolean };

function fixture(options?: {
  enabled?: boolean;
  refreshFallbackMs?: number;
  completionTracker?: BuildFollowUpDependencies["completionTracker"];
}) {
  let enabled = options?.enabled ?? true;
  const locate = vi.fn(
    async (_origin: TriggeredBuildOrigin, _token?: Token): Promise<TriggeredBuildLocation> => ({
      kind: "unknown"
    })
  );
  const getNextBuildNumber = vi.fn(
    async (_environment: JenkinsEnvironmentRef, _jobUrl: string) => 13
  );
  const awaitQueuedBuildStart = vi.fn(
    async (
      _environment: JenkinsEnvironmentRef,
      _queueLocation?: string,
      _submittedJobUrl?: string
    ): Promise<QueuedBuildOutcome | undefined> => undefined
  );
  const showBuildDetails = vi.fn(async (_build: FollowedBuild) => undefined);
  const previewLog = vi.fn(async (_build: FollowedBuild) => undefined);
  const follow = vi.fn(async (_build: FollowedBuild): Promise<FollowBuildResult> => "following");
  const getBuildManagementState = vi.fn(
    async (_environment: JenkinsEnvironmentRef, _buildUrl: string) => ({
      number: 4,
      building: false,
      keepLog: false,
      displayName: "#4"
    })
  );
  const dataService = { getNextBuildNumber, getBuildManagementState };
  const service = new BuildFollowUpService({
    dataService,
    locator: { locate },
    queuedBuildWaiter: { awaitQueuedBuildStart },
    actions: { showBuildDetails, previewLog },
    completionTracker: options?.completionTracker ?? {
      onDidNotifyCompletion: () => ({ dispose() {} }),
      observeBuildIdentity: () => undefined,
      watchQueueCancellation: () => ({ claim: () => true, dispose() {} }),
      beginSubmittedQueueDiscovery: () => ({ finish() {} }),
      followStartedBuild: follow
    },
    isEnabled: () => enabled,
    ...(options?.refreshFallbackMs !== undefined
      ? { refreshFallbackMs: options.refreshFallbackMs }
      : {})
  });
  const refresh = vi.fn();
  const onSettled = vi.fn(async () => undefined);
  const announce = (
    prepared: PreparedFollow,
    overrides?: Partial<AnnounceAndFollowOptions>
  ): void => {
    service.announceAndFollow(prepared, {
      requestedMessage: TRIGGERED,
      refresh,
      onSettled,
      ...overrides
    });
  };
  return {
    service,
    announce,
    getBuildManagementState,
    locate,
    getNextBuildNumber,
    awaitQueuedBuildStart,
    showBuildDetails,
    previewLog,
    follow,
    refresh,
    onSettled,
    setEnabled: (value: boolean) => {
      enabled = value;
    }
  };
}

/** Answers the "<label> started." message with `choice`; every other message is dismissed. */
function chooseWhenStarted(choice: string): void {
  showInformationMessage.mockImplementation(async (message: string) =>
    message.endsWith(" started.") ? choice : undefined
  );
}

function messages(): string[] {
  return showInformationMessage.mock.calls.map(([message]) => message);
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  showInformationMessage.mockImplementation(async () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([true, false])(
  "hands the located executable to an explicit queue follow with automatic follow set to %s",
  async (enabled) => {
    const queueRead = deferred<JenkinsQueueItem>();
    const settled = deferred<void>();
    const customUrl = `${environment.url}custom-runs/job/demo/13/`;
    const getBuildDetails = vi.fn().mockResolvedValue({
      number: 13,
      url: customUrl,
      queueId: 42,
      building: false,
      result: "SUCCESS"
    });
    const tracker = new BuildCompletionTracker(
      { getQueueItem: vi.fn().mockReturnValue(queueRead.promise), getBuildDetails },
      {
        isCurrentController: () => true,
        previewLog: vi.fn(),
        refreshEnvironment: vi.fn(),
        showBuildDetails: vi.fn()
      }
    );
    const f = fixture({ completionTracker: tracker, enabled });
    try {
      tracker.followQueueItem({ environment, queueId: 42, label: "demo" });
      await flush();
      f.locate.mockResolvedValue({ ...startedBuild, kind: "started", buildUrl: customUrl });
      f.awaitQueuedBuildStart.mockResolvedValue({ kind: "started", url: customUrl, number: 13 });
      f.announce(preparedQueue, { location: queueLocation, onSettled: () => settled.promise });
      await flush();
      queueRead.reject(new JenkinsRequestError("expired", 404));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getBuildDetails.mock.calls.map(([, url]) => url)).toContain(customUrl);
      expect(messages().filter((message) => message.includes("finished:"))).toHaveLength(1);
      expect(tracker.count).toBe(0);
      expect(messages()).not.toContain("folder/demo #13 started.");
      settled.resolve();
      await flush();
      expect(messages().includes("folder/demo #13 started.")).toBe(enabled);
    } finally {
      tracker.dispose();
      f.service.dispose();
    }
  }
);

describe("evidence shared between queue observers", () => {
  function startRunHandoff() {
    const manual = deferred<JenkinsQueueItem>();
    const missing = new JenkinsRequestError("queue item expired", 404);
    const run = { ...startedBuild, buildUrl: `${environment.url}plugin/runs/13/` };
    const status = { number: 13, url: run.buildUrl, queueId: 42, building: true };
    const getBuildDetails = vi.fn(async () => status);
    const tracker = new BuildCompletionTracker(
      { getQueueItem: vi.fn().mockReturnValue(manual.promise), getBuildDetails },
      {
        isCurrentController: () => true,
        showBuildDetails: vi.fn(),
        previewLog: vi.fn(),
        refreshEnvironment: vi.fn()
      },
      { initialPollMs: 20, maxPollMs: 20 }
    );
    const waiter = new QueuedBuildWaiter({ getQueueItem: vi.fn().mockRejectedValue(missing) });
    const locator = new TriggeredBuildLocator({ getBuildDetails: vi.fn() }, waiter);
    const f = fixture({ completionTracker: tracker });
    f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
    tracker.followQueueItem({ environment, queueId: 42, label: "demo" });
    chooseWhenStarted("View Build Details");
    return {
      manual,
      run,
      tracker,
      f,
      missing,
      getBuildDetails,
      announce: () => f.announce(preparedQueue, { location: queueLocation }),
      close: () => {
        f.service.dispose();
        tracker.dispose();
      }
    };
  }

  function automaticLookup() {
    const queue = deferred<JenkinsQueueItem>();
    const runRead = deferred<JenkinsBuildDetails>();
    const run = { ...startedBuild, buildUrl: `${environment.url}plugin/remote-runs/13/` };
    const getQueueItem = vi.fn().mockReturnValue(queue.promise);
    const getBuildDetails = vi.fn().mockReturnValue(runRead.promise);
    const tracker = new BuildCompletionTracker(
      { getBuildDetails, getQueueItem: vi.fn() },
      {
        isCurrentController: () => true,
        showBuildDetails: vi.fn(),
        previewLog: vi.fn(),
        refreshEnvironment: vi.fn()
      },
      { initialPollMs: 20, maxPollMs: 20 }
    );
    const waiter = new QueuedBuildWaiter({ getQueueItem });
    const locator = new TriggeredBuildLocator({ getBuildDetails: vi.fn() }, waiter);
    const f = fixture({ completionTracker: tracker });
    f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
    chooseWhenStarted("View Build Details");
    return {
      queue,
      run,
      runRead,
      f,
      tracker,
      getBuildDetails,
      start: () => f.announce(preparedQueue, { location: queueLocation }),
      expire: () => queue.reject(new JenkinsRequestError("queue item expired", 404)),
      dispose: () => {
        f.service.dispose();
        tracker.dispose();
      }
    };
  }

  it.each([
    "before discovery",
    "before queue expiry",
    "after queue expiry",
    "terminal",
    "stopped poll",
    "wrong number"
  ])(
    "uses a directly followed Run API read for queue discovery with no explicit queue follow (%s)",
    async (timing) => {
      const h = automaticLookup();
      try {
        h.tracker.follow(h.run, "configured");
        await vi.advanceTimersByTimeAsync(20);
        expect(h.getBuildDetails).toHaveBeenCalledOnce();
        if (timing !== "before discovery") {
          h.start();
          await flush();
        }
        if (["after queue expiry", "stopped poll", "wrong number"].includes(timing)) {
          h.expire();
          await flush();
          expect(h.f.onSettled).not.toHaveBeenCalled();
        }
        if (timing === "stopped poll") {
          h.tracker.stopFollowingBuild(environment, h.run.buildUrl, "configured");
          await flush();
          expect(h.f.onSettled).toHaveBeenCalledOnce();
        }
        h.runRead.resolve({
          url: `${jobUrl}13/`,
          number: timing === "wrong number" ? 14 : 13,
          queueId: 42,
          building: timing !== "terminal",
          result: timing === "terminal" ? "SUCCESS" : undefined
        });
        await flush();
        if (timing === "before discovery") h.start();
        h.expire();
        await flush();
        const identified = timing !== "stopped poll" && timing !== "wrong number";
        if (identified)
          expect(h.f.showBuildDetails).toHaveBeenCalledExactlyOnceWith({
            ...h.run,
            queueId: 42,
            requireQueueId: true
          });
        else expect(h.f.showBuildDetails).not.toHaveBeenCalled();
        expect(h.f.onSettled).toHaveBeenCalledTimes(1);
        expect(h.tracker.count).toBe(identified && timing !== "terminal" ? 1 : 0);
        expect(messages().filter((message) => message.includes("finished:"))).toHaveLength(
          timing === "terminal" ? 1 : 0
        );
      } finally {
        h.dispose();
      }
    }
  );

  it.each([
    "running",
    "terminal",
    "partial",
    "superseded",
    "permalink",
    "wrong queue",
    "wrong number",
    "other environment",
    "cancelled",
    "disposed"
  ])(
    "shares only a fresh verified numbered endpoint from an independent %s panel observation",
    async (source) => {
      const h = automaticLookup();
      try {
        h.start();
        await flush();
        if (source === "cancelled") {
          h.queue.resolve({ id: 42, cancelled: true });
          await flush();
        }
        if (source === "disposed") h.dispose();
        const read = {
          ...h.run,
          environment:
            source === "other environment"
              ? { ...environment, scope: "global" as const }
              : environment,
          buildNumber: source === "wrong number" ? 14 : 13,
          queueId: source === "wrong queue" ? 41 : 42,
          observedUrl: source === "permalink" ? `${jobUrl}lastBuild/` : h.run.buildUrl
        };
        if (source === "running") h.tracker.observeRunningBuild(read, true);
        else
          h.tracker.observeBuildIdentity(
            read,
            source === "terminal" ? false : undefined,
            source === "superseded"
          );
        h.expire();
        await flush();
        if (["running", "terminal", "partial"].includes(source))
          expect(h.f.showBuildDetails).toHaveBeenCalledExactlyOnceWith({
            ...h.run,
            queueId: 42,
            requireQueueId: true
          });
        else expect(h.f.showBuildDetails).not.toHaveBeenCalled();
        expect(h.tracker.count).toBe(0);
        expect(h.getBuildDetails).not.toHaveBeenCalled();
      } finally {
        h.dispose();
      }
    }
  );

  it.each(
    ["panel", "run poll"].flatMap((source) =>
      ["before", "after"].map((timing) => ({ source, timing }))
    )
  )(
    "discovers a run from the $source when automatic lookup begins $timing explicit handoff",
    async ({ source, timing }) => {
      const h = startRunHandoff();
      try {
        await flush();
        if (source === "run poll") {
          h.tracker.follow(h.run, "configured");
          expect(h.tracker.count).toBe(2);
        }
        if (timing === "before") {
          h.announce();
          await flush();
          expect(h.f.onSettled).not.toHaveBeenCalled();
        }
        if (source === "panel") h.tracker.observeRunningBuild({ ...h.run, queueId: 42 }, true);
        else await vi.advanceTimersByTimeAsync(20);
        expect(h.tracker.isFollowingBuild(environment, h.run.buildUrl, "configured")).toBe(true);
        expect(h.tracker.isFollowingQueueItem(environment, 42)).toBe(true);
        expect(h.tracker.count).toBe(1);
        if (timing === "after") h.announce();
        await flush();
        expect(h.f.showBuildDetails).toHaveBeenCalledExactlyOnceWith({
          ...h.run,
          queueId: 42,
          requireQueueId: true
        });
        expect(h.f.onSettled).toHaveBeenCalledTimes(1);
        expect(messages().filter((m) => m.endsWith(" started."))).toEqual([
          `${h.run.label} started.`
        ]);
        h.manual.reject(h.missing);
        await flush();
        expect(h.tracker.count).toBe(1);
      } finally {
        h.close();
      }
    }
  );

  it.each(["cancelled", "stopped", "already stopped", "disposed", "unrelated queue"])(
    "does not discover a panel run from a %s queue follow after expiry",
    async (reason) => {
      const h = startRunHandoff();
      try {
        await flush();
        if (reason === "already stopped") {
          h.tracker.observeRunningBuild({ ...h.run, queueId: 42 }, true);
          h.tracker.stopFollowingQueueItem(environment, 42);
        }
        h.announce();
        await flush();
        if (reason === "stopped") h.tracker.stopFollowingQueueItem(environment, 42);
        if (reason === "disposed") h.close();
        if (reason === "cancelled") {
          h.manual.resolve({ id: 42, cancelled: true });
          await flush();
        }
        h.tracker.observeRunningBuild(
          { ...h.run, queueId: reason === "unrelated queue" ? 41 : 42 },
          true
        );
        h.manual.reject(h.missing);
        await flush();
        expect(h.tracker.count).toBe(0);
        expect(h.f.showBuildDetails).not.toHaveBeenCalled();
        expect(messages().filter((m) => m.endsWith(" started."))).toEqual([]);
        expect(messages().filter((m) => m.includes("cancelled in the queue"))).toHaveLength(
          reason === "cancelled" ? 1 : 0
        );
      } finally {
        h.close();
      }
    }
  );

  it.each(
    [true, false].flatMap((enabled) =>
      [
        "tree row",
        "manual task first",
        "manual task last",
        "automatic task first",
        "automatic task last",
        "conflicting jobs",
        "unverified task",
        "wrong queue",
        "stop",
        "dispose",
        "cancel",
        "expired"
      ].map((order) => ({ enabled, order }))
    )
  )(
    "combines exact queue observations for replay without a source job (setting=$enabled, $order)",
    async ({ enabled, order }) => {
      const manual = deferred<JenkinsQueueItem>();
      const automated = deferred<JenkinsQueueItem>();
      const missing = new JenkinsRequestError("expired", 404);
      const manualQueue = vi.fn().mockReturnValueOnce(manual.promise).mockRejectedValue(missing);
      const automaticQueue = vi
        .fn()
        .mockReturnValueOnce(automated.promise)
        .mockRejectedValue(missing);
      const getBuildDetails = vi.fn(async () => ({
        number: 13,
        url: buildLocation,
        queueId: 42,
        building: false,
        result: "SUCCESS"
      }));
      const tracker = new BuildCompletionTracker(
        { getQueueItem: manualQueue, getBuildDetails },
        {
          isCurrentController: () => true,
          showBuildDetails: vi.fn(),
          previewLog: vi.fn(),
          refreshEnvironment: vi.fn()
        }
      );
      const waiter = new QueuedBuildWaiter({ getQueueItem: automaticQueue });
      const locator = new TriggeredBuildLocator({ getBuildDetails: vi.fn() }, waiter);
      const f = fixture({ enabled, completionTracker: tracker });
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
      f.awaitQueuedBuildStart.mockImplementation((...args) =>
        waiter.awaitQueuedBuildStart(...args)
      );
      const number = { id: 42, executable: { number: 13 } };
      const task = { id: 42, task: { url: jobUrl } };
      try {
        const prepared = await f.service.prepare({
          ...causeRequest,
          cause: "replay",
          sourceBuildUrl: `${jobUrl}0/`,
          sourceBuildNumber: 0,
          mayReturnQueueItem: true
        });
        const row = {
          environment,
          queueId: 42,
          label: "demo",
          taskUrl: [
            "tree row",
            "conflicting jobs",
            "unverified task",
            "wrong queue",
            "stop",
            "dispose",
            "cancel",
            "expired"
          ].includes(order)
            ? order === "unverified task"
              ? `${jobUrl}configure/`
              : jobUrl
            : undefined
        };
        if (order === "tree row") {
          tracker.followQueueItem(row);
          await flush();
        }
        f.announce(prepared, { location: queueLocation });
        if (order !== "tree row") tracker.followQueueItem(row);
        await flush();
        if (order.startsWith("automatic task")) {
          if (order.endsWith("last")) {
            manual.resolve(number);
            await flush();
          }
          automated.resolve(task);
          await flush();
          if (order.endsWith("first")) {
            // Discovery may observe 404 before the other observer receives the number.
            await vi.advanceTimersByTimeAsync(2200);
            manual.resolve(number);
          }
        } else if (order.startsWith("manual task")) {
          if (order.endsWith("last")) {
            automated.resolve(number);
            await flush();
          }
          manual.resolve(task);
          await flush();
          if (order.endsWith("first")) {
            await vi.advanceTimersByTimeAsync(2200);
            automated.resolve(number);
          }
        } else if (order === "conflicting jobs") {
          manual.resolve({ id: 42, task: { url: `${environment.url}job/unrelated/` } });
          await flush();
          automated.resolve(number);
        } else {
          if (order === "cancel") manual.resolve({ id: 42, cancelled: true });
          else manual.reject(missing);
          await flush();
          if (order === "stop") tracker.stopFollowingQueueItem(environment, 42);
          if (order === "dispose") {
            f.service.dispose();
            tracker.dispose();
          }
          if (order === "expired") automated.reject(missing);
          else automated.resolve(order === "wrong queue" ? { ...number, id: 24 } : number);
        }
        await vi.advanceTimersByTimeAsync(30_000);
        const resolved =
          order === "tree row" ||
          order.startsWith("automatic task") ||
          order.startsWith("manual task");
        expect(getBuildDetails.mock.calls.length).toBe(resolved ? 1 : 0);
        if (resolved)
          expect(getBuildDetails).toHaveBeenCalledWith(
            environment,
            buildLocation,
            expect.anything()
          );
        expect(messages().filter((m) => m.includes("finished:"))).toHaveLength(resolved ? 1 : 0);
        expect(messages().filter((m) => m.endsWith(" started."))).toHaveLength(
          enabled && (resolved || order === "stop") ? 1 : 0
        );
        expect(tracker.count).toBe(0);
      } finally {
        f.service.dispose();
        tracker.dispose();
      }
    }
  );

  it.each(["other environment", "stopped follow"])(
    "keeps a submitted queue lookup independent of evidence from a %s",
    async (source) => {
      const manual = deferred<JenkinsQueueItem>();
      const getBuildDetails = vi.fn();
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn().mockReturnValue(manual.promise), getBuildDetails },
        {
          isCurrentController: () => true,
          showBuildDetails: vi.fn(),
          previewLog: vi.fn(),
          refreshEnvironment: vi.fn()
        }
      );
      const current =
        source === "other environment" ? { ...environment, environmentId: "other" } : environment;
      const waiter = new QueuedBuildWaiter({
        getQueueItem: async () => ({ id: 42, executable: { number: 13 } })
      });
      const locator = new TriggeredBuildLocator({ getBuildDetails }, waiter);
      const f = fixture({ completionTracker: tracker });
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
      try {
        tracker.followQueueItem({
          environment: current,
          queueId: 42,
          label: "Demo",
          taskUrl: jobUrl
        });
        await flush();
        if (source === "stopped follow") tracker.stopFollowingQueueItem(current, 42);
        const prepared = await f.service.prepare({
          ...causeRequest,
          cause: "replay",
          sourceBuildUrl: `${jobUrl}0/`,
          sourceBuildNumber: 0,
          mayReturnQueueItem: true
        });
        f.announce(prepared, { location: queueLocation });
        await flush();
        expect(f.onSettled).toHaveBeenCalledTimes(1);
        manual.reject(new JenkinsRequestError("expired", 404));
        await flush();
        expect(messages()).toEqual([WAITING]);
        expect(getBuildDetails).not.toHaveBeenCalled();
        expect(tracker.count).toBe(0);
      } finally {
        f.service.dispose();
        tracker.dispose();
      }
    }
  );

  function observe(enabled: boolean, submissionFirst: boolean) {
    const manual = deferred<JenkinsQueueItem>();
    const submitted = deferred<JenkinsQueueItem>();
    const job = `${environment.url}custom-runs/job/widget/`;
    const url = `${job}13/`;
    const terminal = deferred<JenkinsBuildDetails>();
    const getBuildDetails = vi.fn().mockReturnValue(terminal.promise);
    const tracker = new BuildCompletionTracker(
      { getQueueItem: vi.fn().mockReturnValue(manual.promise), getBuildDetails },
      {
        isCurrentController: () => true,
        showBuildDetails: vi.fn(),
        previewLog: vi.fn(),
        refreshEnvironment: vi.fn()
      }
    );
    const waiter = new QueuedBuildWaiter({
      getQueueItem: vi.fn().mockReturnValue(submitted.promise)
    });
    const locator = new TriggeredBuildLocator({ getBuildDetails: vi.fn() }, waiter);
    const f = fixture({ enabled, completionTracker: tracker });
    f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
    f.awaitQueuedBuildStart.mockImplementation((...args) => waiter.awaitQueuedBuildStart(...args));
    const announce = () =>
      f.announce({ request: { ...queueRequest, jobUrl: job } }, { location: queueLocation });
    const follow = () => tracker.followQueueItem({ environment, queueId: 42, label: "widget" });
    const start = async () => {
      if (submissionFirst) {
        announce();
        await flush();
        follow();
      } else {
        follow();
        await flush();
        announce();
      }
      await flush();
    };
    return { f, tracker, getBuildDetails, manual, submitted, terminal, url, start };
  }
  it.each(
    [true, false].flatMap((enabled) =>
      [true, false].flatMap((submissionFirst) =>
        [
          "manual number first",
          "manual number last",
          "manual expired first",
          "manual unidentified first",
          "both expired",
          "dispose discovery",
          "cancelled",
          "stop",
          "dispose"
        ].map((outcome) => ({ enabled, submissionFirst, outcome }))
      )
    )
  )(
    "resolves the item when setting=$enabled, submission first=$submissionFirst, $outcome",
    async ({ enabled, submissionFirst, outcome }) => {
      const h = observe(enabled, submissionFirst);
      const expired = new JenkinsRequestError("queue item expired", 404);
      try {
        await h.start();
        if (outcome === "manual number last") {
          h.submitted.reject(expired);
          await flush();
          h.manual.resolve({ id: 42, executable: { number: 13 } });
        } else if (outcome === "manual number first") {
          h.manual.resolve({ id: 42, executable: { number: 13 } });
          await flush();
          expect(h.tracker.isFollowingBuild(environment, h.url, "configured")).toBe(true);
          h.submitted.reject(expired);
        } else {
          if (outcome === "manual unidentified first") {
            h.manual.resolve({ id: 42, executable: { number: 13, url: `${h.url}console/` } });
          } else h.manual.reject(expired);
          await flush();
          expect(h.tracker.count).toBe(1);
          if (outcome === "dispose discovery") {
            h.f.service.dispose();
            await flush();
            expect(h.tracker.count).toBe(0);
          }
          if (outcome === "stop") h.tracker.stopFollowingQueueItem(environment, 42);
          if (outcome === "dispose") h.tracker.dispose();
          if (outcome === "both expired") h.submitted.reject(expired);
          else if (outcome === "cancelled") h.submitted.resolve({ id: 42, cancelled: true });
          else h.submitted.resolve({ id: 42, executable: { number: 13 } });
        }
        await vi.advanceTimersByTimeAsync(30_000);
        const resolved = outcome.startsWith("manual");
        expect(h.getBuildDetails.mock.calls.map(([, url]) => url)).toEqual(resolved ? [h.url] : []);
        h.terminal.resolve({
          number: 13,
          url: h.url,
          queueId: 42,
          building: false,
          result: "SUCCESS"
        });
        await flush();
        expect(h.tracker.count).toBe(0);
        expect(messages().filter((text) => text.includes("finished:"))).toHaveLength(
          resolved ? 1 : 0
        );
        expect(messages().filter((text) => text.includes("cancelled in the queue"))).toHaveLength(
          outcome === "cancelled" ? 1 : 0
        );
      } finally {
        h.f.service.dispose();
        h.tracker.dispose();
      }
    }
  );
});

describe("queue cancellation notifications across active watchers", () => {
  function watchers(explicitEnvironment = environment) {
    const queued = deferred<JenkinsQueueItem>();
    const locate = deferred<TriggeredBuildLocation>();
    const tracker = new BuildCompletionTracker(
      {
        getQueueItem: vi.fn().mockReturnValue(queued.promise),
        getBuildDetails: vi.fn()
      },
      {
        isCurrentController: () => true,
        previewLog: vi.fn(),
        refreshEnvironment: vi.fn(),
        showBuildDetails: vi.fn()
      }
    );
    const f = fixture({ completionTracker: tracker });
    f.locate.mockReturnValue(locate.promise);
    const explicit = () =>
      tracker.followQueueItem({ environment: explicitEnvironment, queueId: 42, label: "demo" });
    const automatic = () => f.announce(preparedQueue, { location: queueLocation });
    return { tracker, service: f.service, queued, locate, explicit, automatic };
  }

  const explicitNotice = "demo (queue #42) was cancelled in the queue.";
  const automaticNotice = "folder/demo was cancelled in the queue.";
  const cancellations = () =>
    messages().filter((message) => message.includes("was cancelled in the queue"));

  it.each(["automatic", "explicit"])(
    "reports a single cancellation when %s finishes first",
    async (first) => {
      const f = watchers();
      if (first === "automatic") {
        f.explicit();
        f.automatic();
        f.locate.resolve({ kind: "cancelled" });
        await flush();
        f.queued.resolve({ id: 42, cancelled: true });
      } else {
        f.automatic();
        f.explicit();
        f.queued.resolve({ id: 42, cancelled: true });
        await flush();
        f.locate.resolve({ kind: "cancelled" });
      }
      await flush();
      expect(cancellations()).toEqual([first === "automatic" ? automaticNotice : explicitNotice]);
      expect(f.tracker.count).toBe(0);
      // No notification history survives the end of this set of watchers.
      f.explicit();
      await flush();
      expect(cancellations()).toHaveLength(2);
      f.tracker.dispose();
      f.service.dispose();
    }
  );

  it.each(["started", "unknown", "failed", "disposed"])(
    "releases the claim after automatic discovery is %s",
    async (outcome) => {
      const f = watchers();
      f.automatic();
      f.explicit();
      f.queued.resolve({ id: 42, cancelled: true });
      await flush();
      expect(cancellations()).toEqual([explicitNotice]);

      if (outcome === "disposed") f.service.dispose();
      else if (outcome === "failed") {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        f.locate.reject(new Error("unavailable"));
      } else f.locate.resolve(outcome === "started" ? started : { kind: "unknown" });
      await flush();
      f.explicit();
      await flush();
      expect(cancellations()).toEqual([explicitNotice, explicitNotice]);
      f.tracker.dispose();
      f.service.dispose();
    }
  );

  it.each(["stop explicit", "dispose automatic"])(
    "retains the remaining observer after %s",
    async (action) => {
      const f = watchers();
      f.automatic();
      f.explicit();
      await flush();
      if (action === "stop explicit") f.tracker.stopFollowingQueueItem(environment, 42);
      else f.service.dispose();
      f.queued.resolve({ id: 42, cancelled: true });
      f.locate.resolve({ kind: "cancelled" });
      await flush();
      expect(cancellations()).toEqual([
        action === "stop explicit" ? automaticNotice : explicitNotice
      ]);
      f.tracker.dispose();
      f.service.dispose();
    }
  );

  it.each([
    { ...environment, scope: "global" as const },
    { ...environment, environmentId: "other" },
    { ...environment, url: "https://other.example/" }
  ])("keeps cancellations separate for other environments", async (other) => {
    const f = watchers(other);
    f.automatic();
    f.explicit();
    f.queued.resolve({ id: 42, cancelled: true });
    f.locate.resolve({ kind: "cancelled" });
    await flush();
    expect(cancellations().sort()).toEqual([explicitNotice, automaticNotice].sort());
    f.tracker.dispose();
    f.service.dispose();
  });
});

describe("BuildFollowUpService.prepare", () => {
  it.each([
    { displayName: "release-1.4.2", number: 12, description: "Replayed #12" },
    { displayName: "#1234", number: 1234, description: "Replayed #1,234" },
    { displayName: "#12", number: 12, description: "Rebuilt #12" }
  ])(
    "offers follow-up actions for $description (display name: $displayName)",
    async ({ displayName, number, description }) => {
      const f = fixture();
      f.getBuildManagementState.mockResolvedValue({
        number,
        building: false,
        keepLog: false,
        displayName
      });
      f.getNextBuildNumber.mockResolvedValue(number + 1);
      const locator = new TriggeredBuildLocator(
        {
          getBuildDetails: vi.fn().mockResolvedValue({
            number: number + 1,
            actions: [
              {
                causes: [
                  {
                    _class: "org.jenkinsci.plugins.workflow.cps.replay.ReplayCause",
                    shortDescription: description
                  }
                ]
              }
            ]
          })
        },
        { awaitQueuedBuild: vi.fn() },
        { candidateWindow: 1 }
      );
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));

      const prepared = await f.service.prepare({
        ...causeRequest,
        sourceBuildUrl: `${jobUrl}${number}/`,
        cause: "replay"
      });
      f.announce(prepared);
      await flush();

      expect(showInformationMessage).toHaveBeenCalledWith(
        `folder/demo #${number + 1} started.`,
        ...ACTIONS
      );
      f.service.dispose();
    }
  );

  it("returns a queue request as is, without reading Jenkins", async () => {
    const f = fixture();
    const prepared = await f.service.prepare(queueRequest);

    expect(prepared).toEqual({ request: queueRequest });
    expect(prepared.request).toBe(queueRequest);
    expect(f.getNextBuildNumber).not.toHaveBeenCalled();
    expect(f.getBuildManagementState).not.toHaveBeenCalled();
  });

  it("skips the cause origin without reading Jenkins when following is off", async () => {
    const f = fixture({ enabled: false });
    const replay: CauseFollowRequest = { ...causeRequest, cause: "replay" };

    await expect(f.service.prepare(replay)).resolves.toEqual({ request: replay });
    expect(f.getNextBuildNumber).not.toHaveBeenCalled();
    expect(f.getBuildManagementState).not.toHaveBeenCalled();
  });

  it("reads isEnabled on every call", async () => {
    const f = fixture();
    await expect(f.service.prepare(causeRequest)).resolves.toHaveProperty("causeOrigin");

    f.setEnabled(false);
    const prepared = await f.service.prepare(causeRequest);
    expect(prepared).not.toHaveProperty("causeOrigin");
    expect(f.getNextBuildNumber).toHaveBeenCalledTimes(1);
  });

  it("skips the cause origin for an unparsable build URL", async () => {
    const f = fixture();
    const request: CauseFollowRequest = { ...causeRequest, sourceBuildUrl: jobUrl };

    const prepared = await f.service.prepare(request);
    expect(prepared).toEqual({ request });
    expect(prepared).not.toHaveProperty("causeOrigin");
    expect(f.getNextBuildNumber).not.toHaveBeenCalled();
  });

  it("does not reject and warns when the next build number can't be read", async () => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.getNextBuildNumber.mockRejectedValue(new Error("403"));
    const request: CauseFollowRequest = { ...causeRequest, cause: "replay" };

    const prepared = await f.service.prepare(request);
    expect(prepared).toEqual({ request });
    expect(prepared).not.toHaveProperty("causeOrigin");
    expect(warn).toHaveBeenCalledWith(
      `Unable to read the next build number for ${sourceBuildUrl}.`,
      expect.any(Error)
    );
  });

  it("builds a cause origin with a label derived from the job path", async () => {
    const f = fixture();
    const prepared = await f.service.prepare(causeRequest);

    expect(f.getNextBuildNumber).toHaveBeenCalledWith(environment, jobUrl);
    expect(prepared).toEqual({ request: causeRequest, causeOrigin });
    expect(prepared.causeOrigin).not.toHaveProperty("stageName");
  });

  it.each(["replay", "rebuild", "restart"] as const)(
    "prepares a %s using the source number without fetching its display name",
    async (cause) => {
      const f = fixture();
      const prepared = await f.service.prepare({ ...causeRequest, cause });

      expect(f.getBuildManagementState).not.toHaveBeenCalled();
      expect(prepared.causeOrigin).toEqual({ ...causeOrigin, cause });
    }
  );

  it("uses the provided job label and stage name", async () => {
    const f = fixture();
    const request: CauseFollowRequest = {
      ...causeRequest,
      cause: "restart",
      jobLabel: "Demo Job",
      stageName: "Deploy"
    };

    await expect(f.service.prepare(request)).resolves.toEqual({
      request,
      causeOrigin: {
        kind: "cause",
        environment,
        jobUrl,
        label: "Demo Job",
        firstCandidateNumber: 13,
        sourceBuildNumber: 12,
        cause: "restart",
        stageName: "Deploy"
      }
    });
  });

  it("omits an empty stage name", async () => {
    const f = fixture();
    const prepared = await f.service.prepare({ ...causeRequest, cause: "restart", stageName: "" });
    expect(prepared.causeOrigin).not.toHaveProperty("stageName");
  });
});

describe("BuildFollowUpService.announceAndFollow origin resolution", () => {
  it("follows a queue request through its queue location", async () => {
    const f = fixture();

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()[0]).toBe(WAITING);
    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "folder/demo", queueLocation },
      expect.objectContaining({ isCancellationRequested: false })
    );
    expect(f.awaitQueuedBuildStart).not.toHaveBeenCalled();
  });

  it("follows a relative queue location", async () => {
    const f = fixture();

    f.announce(preparedQueue, { location: "/queue/item/7/" });
    await flush();

    expect(messages()[0]).toBe(WAITING);
    expect(f.locate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "queue", queueLocation: "/queue/item/7/" }),
      expect.anything()
    );
  });

  it.each([
    { name: "no location", location: undefined },
    { name: "a build location", location: buildLocation }
  ])("does not follow a queue request with $name", async ({ location }) => {
    const f = fixture();

    f.announce(preparedQueue, { location, plainMessage: "plain" });
    await flush();

    expect(messages()).toEqual(["plain"]);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, location, jobUrl);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "no location", location: undefined },
    { name: "a build location", location: buildLocation }
  ])("follows the prepared cause origin with $name", async ({ location }) => {
    const f = fixture();

    f.announce(preparedCause, { location, requestedMessage: "Rebuild requested for #12" });
    await flush();

    expect(messages()[0]).toBe("Rebuild requested for #12. Waiting for it to start…");
    expect(f.locate).toHaveBeenCalledTimes(1);
    expect(f.locate.mock.calls[0]?.[0]).toBe(causeOrigin);
  });

  it("prefers a queue location and reuses the prepared job URL and label", async () => {
    const f = fixture();
    const prepared: PreparedFollow = {
      request: { ...causeRequest, jobLabel: "Request Label" },
      causeOrigin: { ...causeOrigin, label: "Prepared Label" }
    };

    f.announce(prepared, { location: queueLocation });
    await flush();

    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "Prepared Label", queueLocation },
      expect.anything()
    );
  });

  it("derives the job URL and label from the source build without a prepared origin", async () => {
    const f = fixture();

    f.announce({ request: causeRequest }, { location: queueLocation });
    await flush();

    expect(messages()[0]).toBe(WAITING);
    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "folder/demo", queueLocation },
      expect.anything()
    );
  });

  it("uses the request's job label without a prepared origin", async () => {
    const f = fixture();

    f.announce({ request: { ...causeRequest, jobLabel: "Demo Job" } }, { location: queueLocation });
    await flush();

    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "Demo Job", queueLocation },
      expect.anything()
    );
  });

  it.each([
    {
      mode: "numbered executable",
      item: { executable: { number: 13, url: buildLocation } },
      resolves: true
    },
    {
      mode: "verified queue task",
      item: { task: { name: "demo", url: jobUrl }, executable: { number: 13 } },
      resolves: true
    },
    { mode: "number without a task", item: { executable: { number: 13 } }, resolves: false }
  ])(
    "discovers a replay of legacy build zero from its queue ID with a $mode",
    async ({ item, resolves }) => {
      const f = fixture();
      const getQueueItem = vi.fn(async () => ({ id: 42, ...item }));
      const getBuildDetails = vi.fn();
      const waiter = new QueuedBuildWaiter({ getQueueItem });
      const locator = new TriggeredBuildLocator({ getBuildDetails }, waiter);
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
      chooseWhenStarted("Notify When Finished");

      const prepared = await f.service.prepare({
        ...causeRequest,
        cause: "replay",
        sourceBuildUrl: `${jobUrl}0/`,
        sourceBuildNumber: 0,
        mayReturnQueueItem: true
      });
      expect(prepared.causeOrigin).toBeUndefined();
      f.announce(prepared, { location: queueLocation });
      await flush();

      expect(messages()).toEqual(resolves ? [WAITING, "folder/demo #13 started."] : [WAITING]);
      expect(f.locate.mock.calls[0]?.[0]).toMatchObject({
        kind: "queue",
        environment,
        queueLocation,
        label: "folder/demo",
        jobUrl: undefined
      });
      expect(getQueueItem).toHaveBeenCalledExactlyOnceWith(environment, 42);
      expect(f.getNextBuildNumber).not.toHaveBeenCalled();
      expect(getBuildDetails).not.toHaveBeenCalled();
      if (resolves) {
        expect(f.follow.mock.calls[0]?.[0]).toEqual({ ...startedBuild, queueId: 42 });
      } else {
        expect(f.follow).not.toHaveBeenCalled();
      }
      expect(f.refresh).toHaveBeenCalledTimes(1);
      expect(f.onSettled).toHaveBeenCalledTimes(1);
      f.service.dispose();
    }
  );

  it("waits for the exact queue item to refresh a replay of build zero with automatic follow off", async () => {
    const f = fixture({ enabled: false });
    const item = deferred<JenkinsQueueItem>();
    const getQueueItem = vi.fn(() => item.promise);
    const waiter = new QueuedBuildWaiter({ getQueueItem });
    f.awaitQueuedBuildStart.mockImplementation((...args) => waiter.awaitQueuedBuildStart(...args));
    const prepared = await f.service.prepare({
      ...causeRequest,
      cause: "replay",
      sourceBuildUrl: `${jobUrl}0/`,
      sourceBuildNumber: 0,
      mayReturnQueueItem: true
    });
    f.announce(prepared, { location: queueLocation, plainMessage: "Replay queued." });
    await flush();
    expect(messages()).toEqual(["Replay queued."]);
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledExactlyOnceWith(
      environment,
      queueLocation,
      undefined
    );
    expect(getQueueItem).toHaveBeenCalledExactlyOnceWith(environment, 42);
    item.resolve({ id: 42, executable: { url: buildLocation, number: 13 } });
    await flush();
    expect(messages()).toEqual(["Replay queued."]);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.locate).not.toHaveBeenCalled();
    f.service.dispose();
  });

  it("retains an explicit replay label when the source URL does not identify its job", async () => {
    const f = fixture();
    f.announce(
      { request: { ...causeRequest, sourceBuildUrl: "not a url", jobLabel: "Replay job" } },
      { location: queueLocation }
    );
    await flush();
    expect(f.locate.mock.calls[0]?.[0]).toMatchObject({
      kind: "queue",
      jobUrl: undefined,
      label: "Replay job",
      queueLocation
    });
  });

  it.each([
    { name: "no location", location: undefined },
    { name: "a build location", location: buildLocation }
  ])("does not follow a cause request with $name and no prepared origin", async ({ location }) => {
    const f = fixture();

    f.announce(
      { request: causeRequest },
      { location, requestedMessage: "Rebuild requested for #12" }
    );
    await flush();

    expect(messages()).toEqual(["Rebuild requested for #12."]);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "queue request", prepared: preparedQueue },
    { name: "prepared cause origin", prepared: preparedCause }
  ])("does not follow a $name once following is turned off", async ({ prepared }) => {
    const f = fixture();
    f.setEnabled(false);

    f.announce(prepared, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([`${TRIGGERED}.`]);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("ignores the plain message when following", async () => {
    const f = fixture();

    f.announce(preparedQueue, { location: queueLocation, plainMessage: "plain" });
    await flush();

    expect(messages()).toEqual([WAITING]);
  });
});

describe("BuildFollowUpService.announceAndFollow refresh timing", () => {
  it("refreshes once at the fallback delay while locate is pending, not again on settle", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedQueue, { location: queueLocation });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).not.toHaveBeenCalled();

    pending.resolve({ kind: "unknown" });
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("refreshes immediately when locate settles first, not again at the fallback delay", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedQueue, { location: queueLocation });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.refresh).not.toHaveBeenCalled();

    pending.resolve({ kind: "unknown" });
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("honours a configured fallback delay", async () => {
    const f = fixture({ refreshFallbackMs: 1_000 });
    f.locate.mockReturnValue(deferred<TriggeredBuildLocation>().promise);

    f.announce(preparedCause);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("runs onSettled after locate settles and after the refresh", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedCause);
    await flush();
    expect(f.locate).toHaveBeenCalledWith(
      causeOrigin,
      expect.objectContaining({ isCancellationRequested: false })
    );
    expect(f.onSettled).not.toHaveBeenCalled();

    pending.resolve({ kind: "unknown" });
    await flush();
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      f.onSettled.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("follows without onSettled", async () => {
    const f = fixture();
    f.locate.mockResolvedValue({ kind: "cancelled" });

    f.announce(preparedQueue, { location: queueLocation, onSettled: undefined });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([WAITING, "folder/demo was cancelled in the queue."]);
  });

  it("warns when onSettled rejects", async () => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.onSettled.mockRejectedValue(new Error("settle failed"));

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Failed to follow the triggered build for folder/demo.",
      expect.any(Error)
    );
  });
});

describe("BuildFollowUpService.announceAndFollow outcomes", () => {
  it("offers actions when the build started", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showInformationMessage).toHaveBeenNthCalledWith(1, WAITING);
    expect(showInformationMessage).toHaveBeenNthCalledWith(
      2,
      "folder/demo #13 started.",
      ...ACTIONS
    );
    expect(f.onSettled.mock.invocationCallOrder[0]).toBeLessThan(
      showInformationMessage.mock.invocationCallOrder[1] ?? 0
    );
    expect(f.showBuildDetails).not.toHaveBeenCalled();
    expect(f.previewLog).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
  });

  it("opens build details when chosen", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    chooseWhenStarted("View Build Details");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.showBuildDetails).toHaveBeenCalledWith({ ...startedBuild, queueId: 42 });
    expect(f.previewLog).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("previews the log when chosen", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    chooseWhenStarted("Preview Log");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.previewLog).toHaveBeenCalledWith({ ...startedBuild, queueId: 42 });
    expect(f.showBuildDetails).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
  });

  it("previews the advertised run when its status reports Jenkins' unknown queue ID", async () => {
    const f = fixture();
    f.locate.mockResolvedValue({
      ...started,
      queueStatus: { number: 13, url: buildLocation, building: true, queueId: -1, requestOrder: 2 }
    });
    chooseWhenStarted("Preview Log");
    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.previewLog).toHaveBeenCalledExactlyOnceWith({ ...startedBuild, queueId: 42 });
  });

  it("preserves a directly observed queue ID when previewing a cause-matched build", async () => {
    const f = fixture();
    f.locate.mockResolvedValue({
      ...started,
      queueId: 17,
      causeObservation: { requestOrder: 2, building: true }
    });
    chooseWhenStarted("Preview Log");
    f.announce(preparedCause);
    await flush();
    expect(f.previewLog).toHaveBeenCalledExactlyOnceWith({
      ...startedBuild,
      queueId: 17,
      requireQueueId: true
    });
  });

  it.each(["cause", "queue"] as const)(
    "resolves identical reported and configured source URLs before %s follow-up",
    async (mode) => {
      const env = { ...environment, url: "https://ci/job/" };
      const path = "custom-runs/job/app/";
      const sourceBuildUrl = `${env.url}${path}12/`;
      chooseWhenStarted("Notify When Finished");
      for (const sourceUrlKind of ["reported", "configured"] as const) {
        const f = fixture();
        const expectedJob = `${env.url}${sourceUrlKind === "reported" ? "job/" : ""}${path}`;
        const expectedBuild = `${expectedJob}13/`;
        const getBuildDetails = vi.fn().mockResolvedValue({
          number: 13,
          queueId: mode === "cause" ? 57 : 42,
          url: expectedBuild,
          actions: [{ causes: [{ _class: "RebuildCause", upstreamBuild: 12 }] }]
        });
        const locator = new TriggeredBuildLocator(
          { getBuildDetails },
          new QueuedBuildWaiter({
            getQueueItem: vi.fn().mockResolvedValue({
              id: 42,
              executable: { number: 13, url: "https://internal/job/app/13/" }
            })
          })
        );
        f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
        // Replay can return a queue ID even when the source job's next number is unavailable.
        if (mode === "queue") {
          vi.spyOn(console, "warn").mockImplementation(() => undefined);
          f.getNextBuildNumber.mockRejectedValueOnce(new Error("unavailable"));
        }
        const request = {
          ...causeRequest,
          environment: env,
          sourceBuildUrl,
          sourceUrlKind,
          sourceBuildNumber: 12
        };
        const prepared = await f.service.prepare(request);
        expect(f.getNextBuildNumber).toHaveBeenCalledWith(env, expectedJob);
        f.announce(prepared, mode === "queue" ? { location: queueLocation } : {});
        await flush();
        expect(f.follow).toHaveBeenCalledWith(
          expect.objectContaining({
            buildUrl: mode === "queue" ? `${env.url}job/app/13/` : expectedBuild,
            buildNumber: 13,
            queueId: mode === "cause" ? 57 : 42
          }),
          "configured",
          mode === "cause" ? 57 : 42,
          undefined
        );
        if (mode === "cause")
          expect(getBuildDetails).toHaveBeenCalledWith(env, expectedBuild, expect.anything());
        f.service.dispose();
      }
    }
  );

  it("keeps a successful submission's public custom job endpoint for completion tracking", async () => {
    const f = fixture();
    const env = { ...environment, url: "https://ci/job/" };
    const job = `${env.url}custom-runs/job/app/`;
    const locator = new TriggeredBuildLocator(
      { getBuildDetails: vi.fn() },
      new QueuedBuildWaiter({
        getQueueItem: vi.fn().mockResolvedValue({ id: 42, executable: { number: 13 } })
      })
    );
    f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
    chooseWhenStarted("Notify When Finished");
    f.announce(
      { request: { ...queueRequest, environment: env, jobUrl: job } },
      { location: queueLocation }
    );
    await flush();
    expect(f.follow).toHaveBeenCalledWith(
      expect.objectContaining({ buildUrl: `${job}13/` }),
      "configured",
      undefined,
      undefined
    );
  });

  it.each([
    "View Build Details",
    "Preview Log",
    "Notify When Finished",
    "also followed in the queue"
  ] as const)(
    "uses the independently confirmed submitted run after the advertised queue endpoint expires (%s)",
    async (action) => {
      const advertised = `${environment.url}jenkins/job/folder/job/demo/13/`;
      const missing = deferred<JenkinsBuildDetails>();
      const getQueueItem = vi.fn().mockResolvedValue({
        id: 42,
        task: { url: jobUrl },
        executable: { number: 13, url: advertised }
      });
      const getBuildDetails = vi.fn(async (_env: JenkinsEnvironmentRef, url: string) => {
        if (url === advertised) return missing.promise;
        return { number: 13, url, building: false, queueId: 42, result: "SUCCESS" };
      });
      const tracker = new BuildCompletionTracker(
        { getQueueItem, getBuildDetails },
        {
          isCurrentController: () => true,
          previewLog: vi.fn(),
          showBuildDetails: vi.fn(),
          refreshEnvironment: vi.fn()
        }
      );
      const f = fixture({ completionTracker: tracker });
      const locator = new TriggeredBuildLocator(
        { getBuildDetails },
        new QueuedBuildWaiter({ getQueueItem })
      );
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
      const completed = vi.fn();
      tracker.onDidNotifyCompletion(completed);
      const shared = action === "also followed in the queue";
      chooseWhenStarted(shared ? "Notify When Finished" : action);
      try {
        f.announce(preparedQueue, { location: queueLocation });
        if (shared)
          tracker.followQueueItem({ environment, queueId: 42, label: "demo", taskUrl: jobUrl });
        await flush();
        missing.reject(new JenkinsRequestError("Incorrect Jenkins prefix", 404));
        await flush();
        expect(getBuildDetails.mock.calls.map(([, url]) => url)).toEqual([
          advertised,
          buildLocation
        ]);
        if (action === "View Build Details") {
          expect(f.showBuildDetails).toHaveBeenCalledWith(
            expect.objectContaining({ buildUrl: buildLocation })
          );
        } else if (action === "Preview Log") {
          expect(f.previewLog).toHaveBeenCalledWith(
            expect.objectContaining({ buildUrl: buildLocation, queueId: 42, requireQueueId: true })
          );
        } else {
          expect(completed).toHaveBeenCalledTimes(1);
          expect(completed).toHaveBeenCalledWith(
            expect.objectContaining({ buildUrl: buildLocation, queueId: 42, result: "SUCCESS" })
          );
          expect(tracker.count).toBe(0);
        }
      } finally {
        tracker.dispose();
        f.service.dispose();
      }
    }
  );

  it.each([
    "fallback first terminal",
    "fallback keeps polling",
    "stop while verifying",
    "already verified advertised",
    "conflicting submissions",
    "no submitted job"
  ] as const)(
    "retains an advertised handoff when the successful submission arrives later (%s)",
    async (scenario) => {
      const advertised = `${environment.url}jenkins/job/folder/job/demo/13/`;
      const primary = deferred<JenkinsBuildDetails>();
      const alternate = deferred<JenkinsBuildDetails>();
      const run = { number: 13, queueId: 42, building: true };
      const getBuildDetails = vi.fn(async (_env: JenkinsEnvironmentRef, url: string) => {
        if (url === advertised) return primary.promise;
        if (getBuildDetails.mock.calls.filter(([, endpoint]) => endpoint === url).length === 1)
          return alternate.promise;
        return { ...run, url, building: false, result: "SUCCESS" };
      });
      const getQueueItem = vi
        .fn()
        .mockResolvedValueOnce({ id: 42, executable: { number: 13, url: advertised } })
        .mockRejectedValue(new JenkinsRequestError("Queue item expired", 404));
      const tracker = new BuildCompletionTracker(
        { getQueueItem, getBuildDetails },
        {
          isCurrentController: () => true,
          previewLog: vi.fn(),
          showBuildDetails: vi.fn(),
          refreshEnvironment: vi.fn()
        },
        { initialPollMs: 50, maxPollMs: 50 }
      );
      const f = fixture({ completionTracker: tracker });
      const locator = new TriggeredBuildLocator(
        { getBuildDetails },
        new QueuedBuildWaiter({ getQueueItem })
      );
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
      const finished = vi.fn();
      tracker.onDidNotifyCompletion(finished);
      chooseWhenStarted("View Build Details");
      try {
        tracker.followQueueItem({ environment, queueId: 42, label: "demo" });
        await vi.advanceTimersByTimeAsync(1);
        expect(tracker.isFollowingBuild(environment, advertised, "configured")).toBe(true);
        if (scenario === "already verified advertised") {
          primary.resolve({ ...run, url: advertised });
          await flush();
        }
        const other =
          scenario === "conflicting submissions"
            ? tracker.beginSubmittedQueueDiscovery(environment, 42, `${environment.url}job/other/`)
            : undefined;
        if (scenario === "no submitted job") {
          const discovery = tracker.beginSubmittedQueueDiscovery(environment, 42);
          expect(await discovery.observations?.whenIdentified).toMatchObject({
            kind: "started",
            build: { buildUrl: advertised }
          });
          discovery.finish();
        } else {
          f.announce(preparedQueue, { location: queueLocation });
        }
        await flush();
        if (scenario !== "already verified advertised")
          primary.reject(new JenkinsRequestError("Missing advertised route", 404));
        await flush();
        if (scenario === "stop while verifying") tracker.stopFollowingQueueItem(environment, 42);
        alternate.resolve({
          ...run,
          url: buildLocation,
          building: scenario === "fallback keeps polling",
          result: "SUCCESS"
        });
        await flush();
        other?.finish();
        if (scenario === "fallback keeps polling") {
          expect(tracker.isFollowingBuild(environment, buildLocation, "configured")).toBe(true);
          expect(tracker.isFollowingBuild(environment, advertised, "configured")).toBe(false);
          expect(tracker.isFollowingQueueItem(environment, 42)).toBe(true);
          await vi.advanceTimersByTimeAsync(100);
        }
        const reads = getBuildDetails.mock.calls.map(([, url]) => url);
        if (
          scenario === "no submitted job" ||
          scenario === "conflicting submissions" ||
          scenario === "already verified advertised"
        ) {
          expect(reads).toEqual([advertised]);
          expect(finished).not.toHaveBeenCalled();
          if (scenario === "already verified advertised")
            expect(f.showBuildDetails).toHaveBeenCalledWith(
              expect.objectContaining({ buildUrl: advertised })
            );
        } else {
          expect(reads).toEqual(
            scenario === "fallback keeps polling"
              ? [advertised, buildLocation, buildLocation]
              : [advertised, buildLocation]
          );
          expect(f.showBuildDetails).toHaveBeenCalledWith(
            expect.objectContaining({ buildUrl: buildLocation })
          );
          expect(finished).toHaveBeenCalledTimes(scenario === "stop while verifying" ? 0 : 1);
          expect(tracker.count).toBe(0);
        }
      } finally {
        tracker.dispose();
        f.service.dispose();
      }
    }
  );

  it("uses the queue executable's custom endpoint for Notify When Finished", async () => {
    const f = fixture();
    const reported = `${environment.url}job/demo/custom-runs/13/`;
    const getQueueItem = vi.fn().mockResolvedValue({
      id: 42,
      task: { url: jobUrl },
      executable: { number: 13, url: reported }
    });
    const locator = new TriggeredBuildLocator(
      { getBuildDetails: vi.fn().mockResolvedValue({ number: 13, url: reported }) },
      new QueuedBuildWaiter({ getQueueItem })
    );
    f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
    chooseWhenStarted("Notify When Finished");
    f.announce(preparedQueue, { location: queueLocation });
    await flush();
    expect(getQueueItem).toHaveBeenCalledWith(environment, 42);
    expect(f.follow).toHaveBeenCalledWith(
      expect.objectContaining({ environment, buildUrl: reported, buildNumber: 13, queueId: 42 }),
      "configured",
      undefined,
      undefined
    );
  });

  it("starts completion tracking when chosen", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    chooseWhenStarted("Notify When Finished");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.follow).toHaveBeenCalledWith(
      { ...startedBuild, queueId: 42 },
      "configured",
      undefined,
      undefined
    );
    expect(messages()).toEqual([WAITING, "folder/demo #13 started."]);
  });

  it.each(
    ["earlier poll first", "confirmation first"].flatMap((order) =>
      ["running", "terminal", "stopped", "disposed"].map((outcome) => ({ order, outcome }))
    )
  )(
    "follows a cause-located rebuild without a queue ID during an earlier tree poll ($order, $outcome)",
    async ({ order, outcome }) => {
      const old = deferred<JenkinsBuildDetails>();
      const fresh = deferred<JenkinsBuildDetails>();
      const treeUrl = buildLocation.replace("/job/folder/", "/view/team/job/folder/");
      const end = { number: 13, url: buildLocation, building: false, result: "SUCCESS" };
      const getBuildDetails = vi
        .fn(async (_environment: JenkinsEnvironmentRef, _url: string) => end as JenkinsBuildDetails)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise);
      if (outcome !== "running")
        getBuildDetails.mockRejectedValue(new JenkinsRequestError("Run removed", 404));
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn(), getBuildDetails },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      const causes = vi.fn(async () => ({
        ...end,
        building: true,
        actions: [{ causes: [{ _class: "RebuildCause", upstreamBuild: 12 }] }]
      }));
      const locator = new TriggeredBuildLocator(
        { getBuildDetails: causes },
        new QueuedBuildWaiter({ getQueueItem: vi.fn() })
      );
      const f = fixture({ completionTracker: tracker });
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
      try {
        tracker.follow({ ...startedBuild, buildUrl: treeUrl }, "configured");
        await vi.advanceTimersByTimeAsync(10_000);
        chooseWhenStarted("Notify When Finished");
        f.announce(await f.service.prepare(causeRequest));
        await flush();
        expect(messages()).toContain("folder/demo #13 started.");
        expect(causes).toHaveBeenCalledWith(environment, buildLocation, {
          includeCauses: true,
          bypassCache: true
        });
        expect(getBuildDetails.mock.calls.map(([, url]) => url)).toEqual([treeUrl, buildLocation]);
        if (outcome === "stopped") tracker.stopFollowingBuild(environment, buildLocation);
        if (outcome === "disposed") tracker.dispose();
        const first = () => old.reject(new JenkinsRequestError("No run at poll start", 404));
        const second = () => fresh.resolve({ ...end, building: outcome === "running" });
        if (order === "earlier poll first") {
          first();
          await flush();
          second();
        } else {
          second();
          await flush();
          first();
        }
        await vi.advanceTimersByTimeAsync(60_000);
        expect(tracker.count).toBe(0);
        expect(messages().filter((m) => m.includes("finished:"))).toHaveLength(
          ["running", "terminal"].includes(outcome) ? 1 : 0
        );
        if (outcome !== "running") expect(getBuildDetails).toHaveBeenCalledTimes(2);
      } finally {
        tracker.dispose();
        f.service.dispose();
      }
    }
  );

  it.each([
    { requestFirst: false, running: true, expected: 2 },
    { requestFirst: true, running: true, expected: 1 },
    { requestFirst: false, running: false, expected: 1 },
    { requestFirst: false, running: true, queueId: 87, expected: 1 }
  ])(
    "separates same-result runs using the cause request order and queue ID ($requestFirst, $running, $queueId)",
    async ({ requestFirst, running, queueId, expected }) => {
      const terminal = {
        number: 13,
        url: buildLocation,
        queueId,
        building: false,
        result: "SUCCESS"
      };
      const prior = deferred<JenkinsBuildDetails>();
      const getBuildDetails = vi
        .fn()
        .mockReturnValueOnce(prior.promise)
        .mockResolvedValue(terminal);
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn(), getBuildDetails },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        },
        { initialPollMs: 0 }
      );
      const causeResponse = deferred<JenkinsBuildDetails>();
      const getCauses = vi.fn().mockReturnValue(causeResponse.promise);
      const locator = new TriggeredBuildLocator(
        { getBuildDetails: getCauses },
        { awaitQueuedBuild: vi.fn() }
      );
      const startDiscovery = deferred<void>();
      const f = fixture({ completionTracker: tracker });
      f.locate.mockImplementation(async (origin, token) => {
        await startDiscovery.promise;
        return locator.locate(origin, token);
      });
      const results = () => messages().filter((text) => text.includes("finished:"));
      try {
        tracker.follow(startedBuild);
        await flush();
        chooseWhenStarted("Notify When Finished");
        f.announce(preparedCause);
        if (requestFirst) startDiscovery.resolve();
        await flush();
        expect(getCauses).toHaveBeenCalledTimes(requestFirst ? 1 : 0);
        prior.resolve(terminal);
        await flush();
        expect(results()).toHaveLength(1);
        startDiscovery.resolve();
        causeResponse.resolve({
          ...terminal,
          building: running,
          actions: [{ causes: [{ _class: "RebuildCause", upstreamBuild: 12 }] }]
        });
        await flush();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(messages()).toContain("folder/demo #13 started.");
        expect(results()).toHaveLength(expected);
        expect(tracker.count).toBe(0);
      } finally {
        tracker.dispose();
        f.service.dispose();
      }
    }
  );

  it.each([
    { noticeOrder: 5, possible: false },
    { noticeOrder: 15, possible: true },
    { noticeOrder: undefined, possible: true }
  ])(
    "compares a delayed alias notification by its original order ($noticeOrder)",
    ({ noticeOrder, possible }) => {
      const events = new vscodeStub.EventEmitter<FollowedBuildCompletion>();
      const watch = new StartedBuildCompletionWatch(events.event, environment);
      watch.identify(startedBuild, "configured", 10);
      const notice = {
        ...startedBuild,
        noticeOrder,
        buildUrl: `${environment.url}custom-runs/13/`,
        aliases: [buildLocation],
        result: "SUCCESS"
      };
      events.fire(notice);
      expect(watch.possibleCompletion).toEqual(possible ? notice : undefined);
      expect(watch.notified).toBe(false);
      watch.dispose();
    }
  );

  it.each(
    ["View Build Details", "Preview Log"].flatMap((action) =>
      [
        { name: "newer running response", building: true, canOpen: false },
        { name: "delayed running response", building: true, beforeFollow: true, canOpen: true },
        {
          name: "running in another environment",
          building: true,
          otherEnvironment: true,
          canOpen: true
        },
        { name: "same known run", building: true, originalId: 92, observedId: 92, canOpen: true },
        {
          name: "terminal replacement without a selection ID",
          building: false,
          observedId: 18,
          canOpen: false
        },
        {
          name: "partial replacement without a selection ID",
          building: undefined,
          observedId: 18,
          canOpen: false
        },
        {
          name: "terminal evidence during anonymous follow",
          building: false,
          observedId: 18,
          whileActive: true,
          canOpen: false
        },
        {
          name: "partial evidence during anonymous follow",
          building: undefined,
          observedId: 18,
          whileActive: true,
          canOpen: false
        },
        {
          name: "delayed terminal observation",
          building: false,
          observedId: 18,
          beforeFollow: true,
          canOpen: true
        },
        {
          name: "partial evidence for a separate controller",
          building: undefined,
          observedId: 18,
          otherEnvironment: true,
          canOpen: true
        },
        {
          name: "terminal evidence for a distinct literal route",
          building: false,
          observedId: 18,
          otherRoute: true,
          canOpen: true
        }
      ].map((scenario) => ({ action, ...scenario }))
    )
  )(
    "protects $action with a cause lookup before the started banner ($name)",
    async ({
      action,
      building,
      observedId,
      originalId,
      beforeFollow,
      whileActive,
      canOpen,
      otherEnvironment,
      otherRoute
    }) => {
      const controller = { ...environment, url: "https://ci.example/public/" };
      const env = otherEnvironment ? { ...controller, environmentId: "other" } : controller;
      const url = `${controller.url}job/folder/job/demo/13/`;
      const internal = "http://jenkins.internal/jenkins/job/folder/job/demo/";
      const sourceUrl = otherRoute
        ? `${env.url}view/team/job/folder/job/demo/12/`
        : `${internal}12/`;
      const observedUrl = otherRoute ? `${env.url}view/team/job/folder/job/demo/13/` : url;
      const terminal = { number: 13, url, queueId: originalId, building: false, result: "SUCCESS" };
      const getStatus = vi.fn().mockResolvedValue(terminal);
      const showBuildDetails = vi.fn();
      const previewLog = vi.fn();
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn(), getBuildDetails: getStatus },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails,
          previewLog
        }
      );
      const observed = vi.spyOn(tracker, "observeBuildIdentity");
      const causes = deferred<JenkinsBuildDetails>();
      const getCauses = vi.fn().mockReturnValue(causes.promise);
      const locator = new TriggeredBuildLocator(
        { getBuildDetails: getCauses },
        { awaitQueuedBuild: vi.fn() }
      );
      const f = fixture({ completionTracker: tracker });
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));
      const finishedChoice = deferred<string>();
      const cleanup = deferred<void>();
      showInformationMessage.mockImplementation(async (message) =>
        message.includes("finished:") ? finishedChoice.promise : undefined
      );
      try {
        const prepared = await f.service.prepare({
          ...causeRequest,
          environment: env,
          sourceBuildUrl: sourceUrl,
          sourceBuildNumber: 12,
          sourceUrlKind: otherRoute ? "configured" : "reported"
        });
        const discover = () => f.announce(prepared, { onSettled: () => cleanup.promise });
        if (beforeFollow) discover();
        tracker.follow(
          { ...startedBuild, environment: controller, buildUrl: url, queueId: originalId },
          "configured"
        );
        if (!whileActive) await vi.advanceTimersByTimeAsync(10_000);
        expect(messages().filter((text) => text.includes("finished:"))).toHaveLength(
          whileActive ? 0 : 1
        );
        if (!beforeFollow) discover();
        expect(getCauses).toHaveBeenCalledWith(env, observedUrl, {
          includeCauses: true,
          bypassCache: true
        });
        causes.resolve({
          ...terminal,
          url: `${internal}13/`,
          building,
          result: building === false ? "SUCCESS" : undefined,
          queueId: observedId,
          actions: [{ causes: [{ _class: "RebuildCause", upstreamBuild: 12 }] }]
        });
        await flush();
        expect(observed).toHaveBeenCalledWith(
          expect.objectContaining({
            environment: env,
            buildUrl: observedUrl,
            observedUrl,
            buildNumber: 13,
            requestOrder: expect.any(Number),
            ...(observedId && { queueId: observedId })
          }),
          building
        );
        if (whileActive) {
          await vi.advanceTimersByTimeAsync(10_000);
          expect(messages().filter((text) => text.includes("finished:"))).toHaveLength(1);
        }
        expect(messages().some((text) => text.endsWith(" started."))).toBe(false);
        finishedChoice.resolve(action);
        await flush();
        expect(showBuildDetails).toHaveBeenCalledTimes(
          canOpen && action === "View Build Details" ? 1 : 0
        );
        expect(previewLog).toHaveBeenCalledTimes(canOpen && action === "Preview Log" ? 1 : 0);
        cleanup.resolve();
        await flush();
        expect(messages().some((text) => text.endsWith(" started."))).toBe(true);
        expect(tracker.count).toBe(0);
      } finally {
        cleanup.resolve();
        f.service.dispose();
        tracker.dispose();
      }
    }
  );

  it("preserves a tree follow created while the started notification was open", async () => {
    const choice = deferred<string>();
    showInformationMessage.mockImplementation(async (message) =>
      message.endsWith(" started.") ? choice.promise : undefined
    );
    let building = true;
    const tracker = new BuildCompletionTracker(
      {
        getQueueItem: vi.fn(),
        getBuildDetails: vi.fn(async () => ({
          url: buildLocation,
          number: startedBuild.buildNumber,
          queueId: 43,
          building,
          result: building ? undefined : "SUCCESS"
        }))
      },
      {
        isCurrentController: () => true,
        refreshEnvironment: vi.fn(),
        showBuildDetails: vi.fn(),
        previewLog: vi.fn()
      }
    );
    const f = fixture({ completionTracker: tracker });
    try {
      f.locate.mockResolvedValue(started);
      f.announce(preparedQueue, { location: queueLocation });
      await flush();
      expect(messages()).toContain("folder/demo #13 started.");
      tracker.follow(startedBuild);
      choice.resolve("Notify When Finished");
      await flush();
      expect(tracker.count).toBe(1);
      expect(tracker.isFollowingQueueItem(environment, 42)).toBe(false);
      building = false;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(tracker.count).toBe(0);
      expect(messages().filter((message) => message.includes("finished:"))).toHaveLength(1);
    } finally {
      tracker.dispose();
      f.service.dispose();
    }
  });

  it.each(["discovery", "banner", "number-only"] as const)(
    "delivers one completion when Notify When Finished is delayed during %s",
    async (timing) => {
      const choice = deferred<string>();
      const discovery = deferred<TriggeredBuildLocation>();
      showInformationMessage.mockImplementation(async (message) =>
        message.endsWith(" started.") ? choice.promise : undefined
      );
      const tracker = new BuildCompletionTracker(
        {
          getQueueItem: vi.fn(),
          getBuildDetails: vi.fn(async () => ({
            url: buildLocation,
            number: startedBuild.buildNumber,
            building: false,
            queueId: timing === "number-only" ? undefined : 42,
            result: "SUCCESS"
          }))
        },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      const f = fixture({ completionTracker: tracker });
      try {
        f.locate.mockReturnValue(discovery.promise);
        f.announce(preparedQueue, { location: queueLocation });
        if (timing !== "discovery") discovery.resolve(started);
        await flush();
        tracker.follow(startedBuild);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(tracker.count).toBe(0);
        expect(messages().filter((message) => message.includes("finished:"))).toHaveLength(1);
        discovery.resolve(started);
        await flush();
        expect(messages()).toContain("folder/demo #13 started.");
        choice.resolve("Notify When Finished");
        await vi.advanceTimersByTimeAsync(60_000);
        expect(tracker.count).toBe(0);
        expect(messages().filter((message) => message.includes("finished:"))).toHaveLength(1);
      } finally {
        tracker.dispose();
        f.service.dispose();
      }
    }
  );

  it.each([42, undefined])(
    "keeps one result when the panel announces completion with queue ID %s before the banner choice",
    async (queueId) => {
      const { BuildDetailsPanelRuntime } = await import(
        "../src/panels/buildDetails/BuildDetailsPanelRuntime"
      );
      const { BuildDetailsPanelState } = await import(
        "../src/panels/buildDetails/BuildDetailsPanelState"
      );
      const choice = deferred<string>();
      showInformationMessage.mockImplementation(async (message) =>
        message.endsWith(" started.") ? choice.promise : undefined
      );
      const terminal = {
        url: buildLocation,
        number: startedBuild.buildNumber,
        building: false,
        queueId,
        displayName: startedBuild.label,
        result: "SUCCESS"
      };
      const tracker = new BuildCompletionTracker(
        {
          getQueueItem: vi.fn(),
          getBuildDetails: vi.fn().mockResolvedValue(terminal)
        },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      const f = fixture({ completionTracker: tracker });
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, buildLocation, "nonce");
      const runtime = new BuildDetailsPanelRuntime({
        state,
        completionTracker: tracker,
        view: {} as never,
        coverageDecorationService: {
          deactivateOwner: vi.fn(),
          clearCoverageContext: vi.fn()
        } as never,
        getBackend: () => undefined,
        getPollingController: () => undefined,
        getCurrentToken: () => 1,
        isTokenCurrent: () => true
      });
      try {
        f.locate.mockResolvedValue(started);
        f.announce(preparedQueue, { location: queueLocation });
        await flush();
        await runtime.showCompletionToast(terminal);
        expect(messages().filter((message) => message.includes("finished"))).toHaveLength(1);
        choice.resolve("Notify When Finished");
        await vi.advanceTimersByTimeAsync(60_000);
        expect(tracker.count).toBe(0);
        expect(messages().filter((message) => message.includes("finished"))).toHaveLength(1);
      } finally {
        runtime.dispose();
        tracker.dispose();
        f.service.dispose();
      }
    }
  );

  it("ignores a delayed started-banner choice after disposal", async () => {
    const choice = deferred<string>();
    showInformationMessage.mockImplementation(async (message) =>
      message.endsWith(" started.") ? choice.promise : undefined
    );
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.announce(preparedQueue, { location: queueLocation });
    await flush();
    f.service.dispose();
    choice.resolve("Notify When Finished");
    await flush();
    expect(f.follow).not.toHaveBeenCalled();
  });

  it("reports when the build is already being followed", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.follow.mockResolvedValue("already-following");
    chooseWhenStarted("Notify When Finished");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showInformationMessage).toHaveBeenLastCalledWith("Already following folder/demo #13.");
  });

  it("does not report an unidentified run as already followed", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.follow.mockResolvedValue("unidentified");
    chooseWhenStarted("Notify When Finished");
    f.announce(preparedQueue, { location: queueLocation });
    await flush();
    expect(messages()).toEqual([WAITING, "folder/demo #13 started."]);
  });

  it("does nothing when the started message is dismissed", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([WAITING, "folder/demo #13 started."]);
    expect(f.showBuildDetails).not.toHaveBeenCalled();
    expect(f.previewLog).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("shows an error when opening build details throws", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.showBuildDetails.mockRejectedValue(new Error("panel failed"));
    chooseWhenStarted("View Build Details");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showErrorMessage).toHaveBeenCalledWith(
      "Unable to open build details for folder/demo #13: panel failed"
    );
  });

  it("shows an error when previewing the log throws", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.previewLog.mockRejectedValue(new Error("tail failed"));
    chooseWhenStarted("Preview Log");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showErrorMessage).toHaveBeenCalledWith(
      "Failed to preview logs for folder/demo #13: tail failed"
    );
  });

  it("reports a build cancelled in the queue", async () => {
    const f = fixture();
    f.locate.mockResolvedValue({ kind: "cancelled" });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([WAITING, "folder/demo was cancelled in the queue."]);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("shows no further message when the build can't be located", async () => {
    const f = fixture();

    f.announce(preparedCause, { requestedMessage: "Rebuild requested for #12" });
    await flush();

    expect(messages()).toEqual(["Rebuild requested for #12. Waiting for it to start…"]);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("treats a rejecting locate as unknown and still refreshes and settles", async () => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.locate.mockRejectedValue(new Error("boom"));

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([WAITING]);
    expect(showErrorMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Failed to locate the triggered build for folder/demo.",
      expect.any(Error)
    );
  });
});

describe("BuildFollowUpService.announceAndFollow without following", () => {
  it("waits for the queued build, then refreshes and settles when disabled", async () => {
    const f = fixture({ enabled: false });
    const wait = deferred<undefined>();
    f.awaitQueuedBuildStart.mockReturnValue(wait.promise);

    f.announce(preparedQueue, { location: queueLocation, plainMessage: "Queued" });
    await flush();
    expect(messages()).toEqual(["Queued"]);
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, queueLocation, jobUrl);
    expect(f.refresh).not.toHaveBeenCalled();

    wait.resolve(undefined);
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      f.onSettled.mock.invocationCallOrder[0] ?? 0
    );
    expect(f.locate).not.toHaveBeenCalled();
    expect(messages()).toEqual(["Queued"]);
  });

  it.each(["trigger", "replay"])(
    "hands a number-only %s executable to the explicit follower before the queue item disappears",
    async (submission) => {
      const submittedJob = `${environment.url}custom-runs/job/demo/`;
      const runUrl = `${submittedJob}13/`;
      const explicitQueueRead = deferred<JenkinsQueueItem>();
      const refreshQueueRead = deferred<JenkinsQueueItem>();
      const terminal = deferred<JenkinsBuildDetails>();
      const getQueueItem = vi
        .fn()
        .mockReturnValueOnce(explicitQueueRead.promise)
        .mockReturnValueOnce(refreshQueueRead.promise)
        .mockRejectedValue(new JenkinsRequestError("expired", 404));
      const getBuildDetails = vi.fn().mockReturnValue(terminal.promise);
      const tracker = new BuildCompletionTracker(
        { getQueueItem, getBuildDetails },
        {
          isCurrentController: () => true,
          previewLog: vi.fn(),
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn()
        }
      );
      const waiter = new QueuedBuildWaiter({ getQueueItem });
      const f = fixture({ enabled: false, completionTracker: tracker });
      f.awaitQueuedBuildStart.mockImplementation((...args) =>
        waiter.awaitQueuedBuildStart(...args)
      );
      try {
        tracker.followQueueItem({ environment, queueId: 42, label: "demo" });
        await flush();
        const prepared = await f.service.prepare(
          submission === "trigger"
            ? { ...queueRequest, jobUrl: submittedJob }
            : {
                ...causeRequest,
                cause: "replay",
                sourceBuildUrl: `${submittedJob}12/`,
                sourceBuildNumber: 12,
                sourceUrlKind: "configured",
                mayReturnQueueItem: true
              }
        );
        f.announce(prepared, { location: queueLocation, plainMessage: "Queued" });
        await flush();
        expect(messages()).toEqual(["Queued"]);
        expect(f.refresh).not.toHaveBeenCalled();
        refreshQueueRead.resolve({ id: 42, executable: { number: 13 } });
        await flush();
        expect(f.refresh).toHaveBeenCalledTimes(1);
        expect(f.onSettled).toHaveBeenCalledTimes(1);
        explicitQueueRead.reject(new JenkinsRequestError("expired", 404));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(getBuildDetails.mock.calls.map(([, url]) => url)).toEqual([runUrl]);
        terminal.resolve({
          number: 13,
          url: runUrl,
          queueId: 42,
          building: false,
          result: "SUCCESS"
        });
        await flush();
        expect(messages().filter((text) => text.includes("finished:"))).toHaveLength(1);
        expect(messages().some((text) => text.endsWith(" started."))).toBe(false);
        expect(tracker.count).toBe(0);
        expect(f.locate).not.toHaveBeenCalled();
        expect(f.getNextBuildNumber).not.toHaveBeenCalled();
      } finally {
        tracker.dispose();
        f.service.dispose();
      }
    }
  );

  it("defaults the plain message to the requested message", async () => {
    const f = fixture({ enabled: false });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([`${TRIGGERED}.`]);
  });

  it("refreshes and settles even when the queued wait rejects", async () => {
    const f = fixture({ enabled: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.awaitQueuedBuildStart.mockRejectedValue(new Error("queue gone"));

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Failed to follow the triggered build for folder/demo.",
      expect.any(Error)
    );
  });

  it("refreshes a cause request immediately without waiting on the queue", async () => {
    const f = fixture({ enabled: false });

    f.announce({ request: causeRequest }, { location: queueLocation });
    await flush();

    expect(f.awaitQueuedBuildStart).not.toHaveBeenCalled();
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      f.onSettled.mock.invocationCallOrder[0] ?? 0
    );
  });

  it.each([
    { name: "a queue location", location: queueLocation },
    { name: "a build location", location: buildLocation },
    { name: "no location", location: undefined }
  ])("waits on $name for a cause request that may return a queue item", async ({ location }) => {
    const f = fixture({ enabled: false });
    const wait = deferred<undefined>();
    f.awaitQueuedBuildStart.mockReturnValue(wait.promise);

    f.announce({ request: { ...causeRequest, mayReturnQueueItem: true } }, { location });
    await flush();
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(
      environment,
      location,
      location === queueLocation ? jobUrl : undefined
    );
    expect(f.refresh).not.toHaveBeenCalled();

    wait.resolve(undefined);
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.locate).not.toHaveBeenCalled();
  });

  it("waits on the location when following is on but the replay origin couldn't be prepared", async () => {
    const f = fixture();

    f.announce(
      { request: { ...causeRequest, cause: "replay", mayReturnQueueItem: true } },
      { location: buildLocation, plainMessage: "Replay started" }
    );
    await flush();

    expect(messages()).toEqual(["Replay started"]);
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, buildLocation, undefined);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("works without onSettled", async () => {
    const f = fixture({ enabled: false });

    f.announce({ request: causeRequest }, { onSettled: undefined });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("BuildFollowUpService.dispose", () => {
  it("cancels a pending locate and suppresses refresh, onSettled, and messages", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    let token: Token | undefined;
    f.locate.mockImplementation(async (_origin, received) => {
      token = received;
      return pending.promise;
    });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();
    expect(token?.isCancellationRequested).toBe(false);

    f.service.dispose();
    expect(token?.isCancellationRequested).toBe(true);

    pending.resolve(started);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.onSettled).not.toHaveBeenCalled();
    expect(messages()).toEqual([WAITING]);
  });

  it("does not run the fallback refresh after dispose while locate is still winding down", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedQueue, { location: queueLocation });
    await vi.advanceTimersByTimeAsync(10_000);
    f.service.dispose();

    // The real locator only notices cancellation between polls, which can be up to 15s apart.
    await vi.advanceTimersByTimeAsync(25_000);
    pending.resolve({ kind: "unknown" });
    await flush();

    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.onSettled).not.toHaveBeenCalled();
  });

  it("cancels every pending follow-up", async () => {
    const f = fixture();
    const tokens: Token[] = [];
    f.locate.mockImplementation(async (_origin, received) => {
      if (received) {
        tokens.push(received);
      }
      return deferred<TriggeredBuildLocation>().promise;
    });

    f.announce(preparedQueue, { location: queueLocation });
    f.announce(preparedCause);
    await flush();
    f.service.dispose();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.isCancellationRequested)).toBe(true);
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it("leaves settled follow-ups alone", async () => {
    const f = fixture();
    let token: Token | undefined;
    f.locate.mockImplementation(async (_origin, received) => {
      token = received;
      return { kind: "unknown" };
    });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();
    f.service.dispose();

    expect(token?.isCancellationRequested).toBe(false);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });
});

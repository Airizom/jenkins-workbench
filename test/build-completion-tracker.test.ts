import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "./helpers/vscodeStub";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails, JenkinsQueueItem } from "../src/jenkins/types";
import { nextBuildObservationOrder } from "../src/services/buildFollow/BuildFollowObservationOrder";
import type {
  FollowedBuild,
  FollowedBuildCompletion,
  PanelCompletionDecision
} from "../src/services/buildFollow/BuildFollowTypes";

const statusBarItem = {
  text: "",
  tooltip: undefined as unknown,
  command: undefined as unknown,
  visible: false,
  show: vi.fn(() => {
    statusBarItem.visible = true;
  }),
  hide: vi.fn(() => {
    statusBarItem.visible = false;
  }),
  dispose: vi.fn()
};

function createPicker() {
  const accept = new EventEmitter<void>();
  const hide = new EventEmitter<void>();
  const picker = {
    placeholder: "",
    items: [] as Array<{ label: string; description?: string }>,
    activeItems: [] as Array<{ label: string }>,
    selectedItems: [] as unknown[],
    onDidAccept: accept.event,
    onDidHide: hide.event,
    show: vi.fn(),
    hide: () => hide.fire(),
    dispose: vi.fn(),
    select(index: number) {
      picker.selectedItems = [picker.items[index]];
      accept.fire();
    }
  };
  return picker;
}

let picker = createPicker();
const window = {
  createQuickPick: vi.fn(() => {
    picker = createPicker();
    return picker;
  }),
  createStatusBarItem: vi.fn(() => statusBarItem),
  showInformationMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => {
    return undefined;
  }),
  showWarningMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => {
    return undefined;
  }),
  showErrorMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => {
    return undefined;
  })
};

vi.doMock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  EventEmitter,
  window
}));

const { BuildCompletionTracker, SHOW_FOLLOWED_BUILDS_COMMAND } = await import(
  "../src/services/buildFollow/BuildCompletionTracker"
);
const { BuildFollowUpService } = await import("../src/services/buildFollow/BuildFollowUpService");
const { BuildDetailsPanelState, readPanelBuildDetails } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelState"
);
const { BuildDetailsPanelRuntime } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelRuntime"
);
const { BuildDetailsCompletionCoordinator } = await import(
  "../src/panels/buildDetails/BuildDetailsCompletionCoordinator"
);
const { JenkinsActionError, JenkinsRequestError } = await import("../src/jenkins/errors");

type Tracker = InstanceType<typeof BuildCompletionTracker>;
type DetailsResponse = Partial<JenkinsBuildDetails> | Error;

function createBuild(number: number, job = "folder/job"): FollowedBuild {
  return {
    environment: {
      environmentId: "env-1",
      scope: "global",
      url: "https://jenkins.example/",
      name: "Primary"
    },
    buildUrl: `https://jenkins.example/job/${job}/${number}/`,
    buildNumber: number,
    label: `${job} #${number}`
  };
}

function createHarness(
  responses: DetailsResponse[] | ((buildUrl: string) => DetailsResponse),
  options?: { initialPollMs?: number; maxPollMs?: number; maxConsecutiveErrors?: number }
) {
  const queue = Array.isArray(responses) ? [...responses] : undefined;
  const respond = Array.isArray(responses) ? undefined : responses;
  const getBuildDetails = vi.fn(async (_environment: unknown, buildUrl: string) => {
    const next = queue ? (queue.shift() ?? { building: true }) : (respond?.(buildUrl) ?? {});
    if (next instanceof Error) {
      throw next;
    }
    return {
      number: Number(new URL(buildUrl).pathname.split("/").filter(Boolean).at(-1)),
      url: buildUrl,
      ...next
    } as JenkinsBuildDetails;
  });
  const getQueueItem = vi.fn(
    async (_environment: JenkinsEnvironmentRef, id: number): Promise<JenkinsQueueItem> => ({ id })
  );
  const actions = {
    isCurrentController: vi.fn((_environment: JenkinsEnvironmentRef) => true),
    showBuildDetails: vi.fn(async (_build: FollowedBuild) => undefined),
    previewLog: vi.fn(async (_build: FollowedBuild) => undefined),
    refreshEnvironment: vi.fn((_environmentId: string) => undefined)
  };
  const tracker: Tracker = new BuildCompletionTracker(
    { getBuildDetails, getQueueItem },
    actions,
    options
  );
  return { tracker, getBuildDetails, getQueueItem, actions };
}

async function openFirstFollowedBuild(tracker: Tracker): Promise<void> {
  const open = tracker.showFollowedBuilds();
  picker.select(0);
  await Promise.resolve();
  picker.select(0);
  return open;
}

describe("BuildCompletionTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    picker = createPicker();
    vi.clearAllMocks();
    statusBarItem.text = "";
    statusBarItem.tooltip = undefined;
    statusBarItem.command = undefined;
    statusBarItem.visible = false;
    window.showInformationMessage.mockImplementation(async () => undefined);
    window.showWarningMessage.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(
    ["terminal first", "404 first"].flatMap((order) =>
      ["old terminal", "new terminal", "stop", "dispose"].map((outcome) => ({ order, outcome }))
    )
  )(
    "preserves an exact terminal observation when overlapping requests end with a 404 ($order, $outcome)",
    async ({ order, outcome }) => {
      const build = { ...createBuild(9, "app"), queueId: 17 };
      const { tracker, getBuildDetails } = createHarness([]);
      const settles: ((terminal: boolean) => void)[] = [];
      getBuildDetails.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            settles.push((terminal) =>
              terminal
                ? resolve({
                    number: 9,
                    url: build.buildUrl,
                    queueId: 17,
                    building: false,
                    result: "SUCCESS"
                  })
                : reject(new JenkinsRequestError("Deleted", 404))
            );
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild(build);
      assert.equal(settles.length, 2);
      if (outcome === "stop") tracker.stopFollowingQueueItem(build.environment, 17);
      if (outcome === "dispose") tracker.dispose();
      const terminal = outcome === "new terminal" ? settles[1] : settles[0];
      const failed = terminal === settles[1] ? settles[0] : settles[1];
      if (order === "terminal first") {
        terminal(true);
        await vi.advanceTimersByTimeAsync(0);
        failed(false);
      } else {
        failed(false);
        await vi.advanceTimersByTimeAsync(0);
        terminal(true);
      }
      await choice;
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        ["stop", "dispose"].includes(outcome) ? 0 : 1
      );
      tracker.dispose();
    }
  );

  it.each(["confirmed", "stopped", "disposed"])(
    "keeps the known follow available after an older 404 until its banner verification settles (%s)",
    async (action) => {
      const build = { ...createBuild(9, "app"), queueId: 17 };
      const { tracker, getBuildDetails } = createHarness([]);
      let fail!: () => void;
      let confirm!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = () => reject(new JenkinsRequestError("Missing", 404));
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirm = () =>
              resolve({
                number: 9,
                url: build.buildUrl,
                queueId: 17,
                building: false,
                result: "SUCCESS"
              });
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild(build);
      fail();
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), true);
      assert.equal(window.showWarningMessage.mock.calls.length, 0);
      if (action === "stopped") tracker.stopFollowingQueueItem(build.environment, 17);
      if (action === "disposed") tracker.dispose();
      confirm();
      await choice;
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, action === "confirmed" ? 1 : 0);
      tracker.dispose();
    }
  );

  it.each(["404", "different executable", "cancelled", "stopped", "disposed"])(
    "accepts a discovered executable while its own queue request is outstanding (%s)",
    async (late) => {
      const build = createBuild(9, "app");
      const { tracker, getQueueItem, getBuildDetails } = createHarness([
        { building: false, queueId: 17, result: "SUCCESS" }
      ]);
      let release!: () => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            release = () =>
              late === "404"
                ? reject(new JenkinsRequestError("Expired", 404))
                : resolve(
                    late === "cancelled"
                      ? { id: 17, cancelled: true }
                      : { id: 17, executable: { number: 10, url: createBuild(10).buildUrl } }
                  );
          })
      );
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      if (late === "stopped") tracker.stopFollowingQueueItem(build.environment, 17);
      if (late === "disposed") tracker.dispose();
      await tracker.acceptLocatedQueueBuild(build, 17);
      const active = !["stopped", "disposed"].includes(late);
      assert.equal(tracker.isFollowingBuild(build.environment, build.buildUrl), active);
      release();
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(tracker.count, 0);
      assert.deepEqual(
        getBuildDetails.mock.calls.map(([, url]) => url),
        active ? [build.buildUrl] : []
      );
      assert.equal(window.showInformationMessage.mock.calls.length, active ? 1 : 0);
      assert.equal(window.showWarningMessage.mock.calls.length, 0);
      tracker.dispose();
    }
  );

  it.each(["queued run", "incumbent", "stop queue"])(
    "confirms an automatically supplied executable against its conflicting URL owner (%s)",
    async (outcome) => {
      const build = createBuild(9, "app");
      const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
      let expire!: () => void;
      let confirm!: (queueId: number) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            expire = () => reject(new JenkinsRequestError("Expired", 404));
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirm = (queueId) =>
              resolve({ number: 9, url: build.buildUrl, queueId, building: true });
          })
      );
      tracker.follow({ ...build, queueId: 18 });
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      const accepting = tracker.acceptLocatedQueueBuild(build, 17);
      await vi.advanceTimersByTimeAsync(0);
      expire();
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 2);
      if (outcome === "stop queue") tracker.stopFollowingQueueItem(build.environment, 17);
      confirm(outcome === "incumbent" ? 18 : 17);
      await accepting;
      assert.equal(tracker.count, 1);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), outcome === "queued run");
      assert.equal(tracker.isFollowingQueueItem(build.environment, 18), outcome !== "queued run");
      assert.equal(getQueueItem.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it("accepts an automatic queue match only for the same environment, queue and executable", async () => {
    const build = createBuild(9, "app");
    const { tracker, getQueueItem } = createHarness([]);
    await tracker.acceptLocatedQueueBuild(build, 17);
    assert.equal(tracker.count, 0);
    tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
    await tracker.acceptLocatedQueueBuild(
      { ...build, environment: { ...build.environment, scope: "workspace" } },
      17
    );
    await tracker.acceptLocatedQueueBuild({ ...build, buildNumber: 10 }, 17);
    await tracker.acceptLocatedQueueBuild({ ...build, queueId: 19 }, 17);
    await tracker.acceptLocatedQueueBuild(build, 18);
    assert.equal(tracker.isFollowingBuild(build.environment, build.buildUrl), false);
    await tracker.acceptLocatedQueueBuild(build, 17);
    assert.equal(tracker.isFollowingBuild(build.environment, build.buildUrl), true);
    assert.equal(getQueueItem.mock.calls.length, 0);
    tracker.dispose();
  });

  it.each(
    [undefined, 17].flatMap((previousId) =>
      ["direct first", "banner first"].flatMap((order) =>
        ["same run", "replacement", "direct missing", "banner missing"].map((observation) => ({
          previousId,
          order,
          observation
        }))
      )
    )
  )(
    "correlates a cause banner using its own response ($order, original queue $previousId, $observation)",
    async ({ previousId, order, observation }) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails } = createHarness([]);
      const readers: ((id?: number) => void)[] = [];
      getBuildDetails.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            readers.push((id) =>
              id === undefined
                ? reject(new JenkinsRequestError("Already removed", 404))
                : resolve({
                    number: 9,
                    url: build.buildUrl,
                    queueId: id,
                    building: false,
                    result: "SUCCESS"
                  })
            );
          })
      );
      const notices: (number | undefined)[] = [];
      tracker.onDidNotifyCompletion((receipt) => {
        notices.push(receipt.queueId);
      });
      tracker.follow({ ...build, queueId: previousId });
      await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild(build, "configured");
      assert.equal(readers.length, 2);
      const direct = () => readers[0](observation === "direct missing" ? undefined : 17);
      const banner = () =>
        readers[1](
          observation === "banner missing" ? undefined : observation === "same run" ? 17 : 18
        );
      const [first, second] = order === "direct first" ? [direct, banner] : [banner, direct];
      first();
      await vi.advanceTimersByTimeAsync(0);
      second();
      await choice;
      await vi.advanceTimersByTimeAsync(0);
      assert.deepEqual(
        notices.sort(),
        observation === "replacement" ? [17, 18] : observation === "direct missing" ? [18] : [17]
      );
      assert.equal(tracker.count, 0);
      tracker.dispose();
    }
  );

  it.each(["before direct poll", "direct first", "banner first"])(
    "tracks the queue ID actually reported for a running cause-located run (%s)",
    async (order) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails } = createHarness([
        { queueId: 18, building: false, result: "SUCCESS" }
      ]);
      let direct!: () => void;
      let fresh!: () => void;
      if (order !== "before direct poll")
        getBuildDetails.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              direct = () =>
                resolve({
                  number: 9,
                  url: build.buildUrl,
                  queueId: 17,
                  building: false,
                  result: "SUCCESS"
                });
            })
        );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            fresh = () => resolve({ number: 9, url: build.buildUrl, queueId: 18, building: true });
          })
      );
      const notices: (number | undefined)[] = [];
      tracker.onDidNotifyCompletion((notice) => {
        notices.push(notice.queueId);
      });
      tracker.follow({ ...build, queueId: 17 });
      if (order !== "before direct poll") await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild(build, "configured");
      if (order === "direct first") {
        direct();
        await vi.advanceTimersByTimeAsync(0);
      }
      fresh();
      await vi.advanceTimersByTimeAsync(0);
      if (order === "banner first") direct();
      await choice;
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 18), true);
      await vi.advanceTimersByTimeAsync(30_000);
      assert.deepEqual(notices, order === "before direct poll" ? [18] : [17, 18]);
      tracker.dispose();
    }
  );

  it("merges Notify When Finished with a followed queue entry before its next poll", async () => {
    const { tracker, actions, getBuildDetails, getQueueItem } = createHarness([{ building: true }]);
    const build = createBuild(13, "app");
    const { environment } = build;
    const service = new BuildFollowUpService({
      locator: { locate: async () => ({ kind: "started", ...build }) },
      dataService: { getNextBuildNumber: vi.fn() },
      queuedBuildWaiter: { awaitQueuedBuildStart: vi.fn() },
      actions,
      completionTracker: tracker,
      isEnabled: () => true
    });
    try {
      tracker.followQueueItem({ environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(getQueueItem.mock.calls.length, 1);
      window.showInformationMessage.mockImplementation(async (...args) =>
        args.includes("Notify When Finished") ? "Notify When Finished" : undefined
      );
      service.announceAndFollow(
        {
          request: {
            kind: "queue",
            environment,
            jobUrl: new URL("../", build.buildUrl).href,
            label: "app"
          }
        },
        { location: "/queue/item/17/", requestedMessage: "Triggered app", refresh: vi.fn() }
      );
      await vi.advanceTimersByTimeAsync(0);
      assert.ok(tracker.isFollowingBuild(environment, build.buildUrl));
      assert.equal(tracker.count, 1);
      assert.equal(getQueueItem.mock.calls.length, 1);
      tracker.stopFollowingQueueItem(environment, 17);
      assert.equal(tracker.count, 0);
      const previousPolls = getBuildDetails.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(getBuildDetails.mock.calls.length, previousPolls);
    } finally {
      service.dispose();
      tracker.dispose();
    }
  });

  it.each([true, false])(
    "handles a pending queue response after panel handoff (stopped=%s)",
    async (stop) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness([
        { building: true, queueId: 17 }
      ]);
      const build = { ...createBuild(9, "app"), queueId: 17 };
      const other = createBuild(9, "other");
      let release: (value: JenkinsQueueItem) => void = () =>
        assert.fail("Expected a pending queue read");
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.observeRunningBuild(build);
      if (stop) tracker.stopFollowingBuild(build.environment, build.buildUrl);
      release({ id: 17, executable: { number: 9, url: other.buildUrl } });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, stop ? 0 : 1);
      assert.equal(tracker.isFollowingBuild(other.environment, other.buildUrl), !stop);
      assert.equal(getBuildDetails.mock.calls.length, stop ? 0 : 1);
      tracker.dispose();
    }
  );

  it.each(["completed", "stopped", "disposed", "different number"])(
    "handles a late executable URL after the owning subscription is %s",
    async (outcome) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness([
        { building: false, result: "SUCCESS", queueId: 17 }
      ]);
      const build = { ...createBuild(9, "app"), queueId: 17 };
      const executable = createBuild(outcome === "different number" ? 10 : 9, "alternate");
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, executable.buildUrl, "nonce");
      const details = { number: executable.buildNumber, url: executable.buildUrl, building: true };
      state.updateDetails(details);
      const notify = vi.fn((event: FollowedBuildCompletion) =>
        state.recordFollowedBuildCompletion(event)
      );
      tracker.onDidNotifyCompletion(notify);
      let release!: (item: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.follow(build, "configured");
      if (outcome === "stopped") tracker.stopFollowingQueueItem(build.environment, 17);
      if (outcome === "disposed") tracker.dispose();
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      const polls = getBuildDetails.mock.calls.length;
      const notices = window.showInformationMessage.mock.calls.length;
      release({ id: 17, executable: { number: executable.buildNumber, url: executable.buildUrl } });
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(
        state.hasCompletionNotice({ ...details, building: false }),
        outcome === "completed"
      );
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length, polls);
      assert.equal(window.showInformationMessage.mock.calls.length, notices);
      if (outcome === "completed") {
        assert.deepEqual(
          notify.mock.calls.map(([notice]) => [notice.buildUrl, notice.result]),
          [
            [build.buildUrl, "SUCCESS"],
            [executable.buildUrl, "SUCCESS"]
          ]
        );
        assert.ok(notify.mock.calls[0][0].noticeOrder);
        assert.equal(notify.mock.calls[0][0].noticeOrder, notify.mock.calls[1][0].noticeOrder);
      }
      tracker.dispose();
    }
  );

  it.each([true, false])(
    "retires only an overlapping direct follow when a late executable identifies it (overlap=%s)",
    async (overlap) => {
      const build = { ...createBuild(9, "app"), queueId: 17 };
      const alternate = createBuild(9, "alternate");
      const { tracker, getQueueItem, getBuildDetails } = createHarness(() => ({
        building: false,
        queueId: 17,
        result: "SUCCESS"
      }));
      let release!: (item: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      if (overlap) tracker.follow(alternate);
      tracker.follow(build, "configured");
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      if (!overlap) tracker.follow(alternate);
      assert.equal(tracker.count, 1);
      release({ id: 17, executable: { number: 9, url: alternate.buildUrl } });
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(tracker.count, overlap ? 0 : 1);
      if (overlap) {
        await vi.advanceTimersByTimeAsync(30_000);
        assert.equal(getBuildDetails.mock.calls.length, 2);
        assert.equal(window.showInformationMessage.mock.calls.length, 1);
      }
      tracker.dispose();
    }
  );

  it.each(
    ["matching", "distinct", "missing", "failure", "stopped", "disposed"].flatMap((outcome) =>
      ["panel", "tracker"].map((source) => ({ outcome, source }))
    )
  )(
    "holds a $source terminal result with no queue ID until its $outcome queue response",
    async ({ outcome, source }) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness([
        { building: false, result: "SUCCESS" }
      ]);
      const primary = { ...createBuild(9, "primary"), queueId: 17 };
      const alternate = createBuild(9, "alternate");
      let resolve!: (value: JenkinsQueueItem) => void;
      let reject!: () => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = () => no(new Error("unavailable"));
          })
      );
      tracker.followQueueItem({ environment: primary.environment, queueId: 17, label: "primary" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.follow(alternate);
      void tracker.claimPanelCompletion({ notice: { ...primary, result: "SUCCESS", queueId: 17 } });
      let panelDone: Promise<unknown> | undefined;
      if (source === "tracker") await vi.advanceTimersByTimeAsync(10000);
      else {
        const state = new BuildDetailsPanelState();
        state.resetForLoad(alternate.environment, alternate.buildUrl, "token");
        const details = { number: 9, url: alternate.buildUrl, building: true };
        state.updateDetails(details);
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
        panelDone = Promise.all([
          runtime.showCompletionToast({ ...details, building: false, result: "SUCCESS" }),
          runtime.showCompletionToast({ ...details, building: false, result: "SUCCESS" })
        ]).finally(() => runtime.dispose());
      }
      await vi.advanceTimersByTimeAsync(90_000);
      assert.equal(tracker.count, 1);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(getBuildDetails.mock.calls.length, source === "tracker" ? 1 : 0);
      if (outcome === "stopped")
        tracker.stopFollowingBuild(alternate.environment, alternate.buildUrl);
      if (outcome === "disposed") tracker.dispose();
      if (outcome === "matching")
        getBuildDetails.mockResolvedValueOnce({
          number: 9,
          url: alternate.buildUrl,
          queueId: 17,
          building: false
        });
      if (outcome === "failure") reject();
      else if (outcome === "missing") resolve({ id: 17 });
      else
        resolve({
          id: 17,
          executable: {
            number: 9,
            url: outcome === "matching" ? alternate.buildUrl : primary.buildUrl
          }
        });
      await vi.advanceTimersByTimeAsync(0);
      await panelDone;
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        ["matching", "stopped", "disposed"].includes(outcome) ? 1 : 2
      );
      assert.equal(getQueueItem.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it.each([true, false])(
    "waits only for the overlapping queue reads (later alias matches=%s)",
    async (matches) => {
      const { tracker, getQueueItem } = createHarness([{ queueId: 18, building: false }]);
      const alternate = createBuild(9, "alternate");
      const releases: ((item: JenkinsQueueItem) => void)[] = [];
      getQueueItem.mockImplementation(
        () =>
          new Promise((resolve) => {
            releases.push(resolve);
          })
      );
      tracker.follow(alternate);
      for (const id of [17, 18, 19]) {
        tracker.followQueueItem({ environment: alternate.environment, queueId: id, label: "app" });
        await vi.advanceTimersByTimeAsync(0);
        const number = id === 19 ? 10 : 9;
        void tracker.claimPanelCompletion({
          notice: { ...createBuild(number, `job-${id}`), result: "SUCCESS", queueId: id }
        });
      }
      void tracker.claimPanelCompletion({ notice: { ...alternate, result: "SUCCESS" } });
      releases[0]({ id: 17 });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(window.showInformationMessage.mock.calls.length, 3);
      releases[1]({
        id: 18,
        executable: {
          number: 9,
          url: matches ? alternate.buildUrl : createBuild(9, "other").buildUrl
        }
      });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, matches ? 3 : 4);
      tracker.dispose();
      releases[2]({ id: 19 });
    }
  );

  it.each(
    ["matching", "distinct", "disappeared", "stopped"].flatMap((outcome) =>
      ["queued terminal", "executable"].map((next) => ({ outcome, next }))
    )
  )(
    "announces the direct result first, then the $next with a $outcome endpoint",
    async ({ outcome, next }) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness(() => ({
        building: outcome !== "matching",
        queueId: 17,
        result: "SUCCESS"
      }));
      const primary = { ...createBuild(9, "primary"), queueId: 17 };
      const alternate = createBuild(9, "alternate");
      let release!: (value: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      tracker.followQueueItem({ environment: primary.environment, queueId: 17, label: "primary" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.follow(alternate);
      void tracker.claimPanelCompletion({ notice: { ...alternate, result: "SUCCESS" } });
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      tracker.observeRunningBuild(primary);
      if (next === "queued terminal") {
        void tracker.claimPanelCompletion({
          notice: { ...primary, result: "SUCCESS", queueId: 17 }
        });
        assert.equal(window.showInformationMessage.mock.calls.length, 1);
      }
      if (outcome === "stopped") tracker.stopFollowingQueueItem(primary.environment, 17);
      release(
        outcome === "disappeared"
          ? { id: 17 }
          : {
              id: 17,
              executable: {
                number: 9,
                url: outcome === "matching" ? alternate.buildUrl : primary.buildUrl
              }
            }
      );
      await vi.advanceTimersByTimeAsync(0);
      if (next === "executable" && tracker.count > 0)
        void tracker.claimPanelCompletion({
          notice: { ...primary, result: "SUCCESS", queueId: 17 }
        });
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        ["matching", "stopped"].includes(outcome) ? 1 : 2
      );
      assert.equal(tracker.count, 0);
      assert.equal(
        getBuildDetails.mock.calls.length,
        outcome === "matching" ||
          (next === "executable" && ["distinct", "disappeared"].includes(outcome))
          ? 1
          : 0
      );
      tracker.dispose();
    }
  );

  it("does not hold a same-number result from a different controller for an unrelated queue read", async () => {
    const { tracker, getQueueItem } = createHarness([]);
    const primary = { ...createBuild(9, "primary"), queueId: 17 };
    const other = {
      ...createBuild(9, "other"),
      environment: { ...primary.environment, scope: "workspace" as const }
    };
    let release!: (item: JenkinsQueueItem) => void;
    getQueueItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    tracker.followQueueItem({ environment: primary.environment, queueId: 17, label: "primary" });
    await vi.advanceTimersByTimeAsync(0);
    tracker.follow(other);
    tracker.claimPanelCompletion({ notice: { ...other, result: "SUCCESS" } });
    tracker.claimPanelCompletion({ notice: { ...primary, result: "SUCCESS", queueId: 17 } });
    assert.equal(window.showInformationMessage.mock.calls.length, 2);
    assert.equal(tracker.count, 0);
    release({ id: 17, executable: { number: 9, url: other.buildUrl } });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(window.showInformationMessage.mock.calls.length, 2);
    tracker.dispose();
  });

  it.each(["stopped", "completed", "panel identified", "never followed"])(
    "follows a reused URL when the previous run with a different queue ID was %s",
    async (previous) => {
      const { tracker, getQueueItem } = createHarness([{ queueId: 18, building: true }]);
      const build = createBuild(9, "app");
      getQueueItem.mockResolvedValue({ id: 18, executable: { number: 9, url: build.buildUrl } });
      tracker.followQueueItem({ environment: build.environment, queueId: 18, label: "app" });
      if (previous !== "never followed")
        tracker.follow(previous === "panel identified" ? build : { ...build, queueId: 17 });
      if (previous === "stopped") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      else tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS", queueId: 17 } });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 1);
      assert.ok(tracker.isFollowingBuild(build.environment, build.buildUrl));
      assert.ok(tracker.isFollowingQueueItem(build.environment, 18));
      tracker.dispose();
    }
  );

  it.each(
    ["matching", "distinct", "missing", "error", "stopped", "disposed"].flatMap((response) =>
      ["known first", "panel first"].map((order) => ({ response, order }))
    )
  )(
    "uses the outstanding direct status read for a $response result ($order)",
    async ({ response, order }) => {
      const { tracker, getBuildDetails } = createHarness([]);
      const primary = { ...createBuild(9, "primary"), queueId: 17 };
      const alternate = createBuild(9, "alternate");
      let resolve!: (details: JenkinsBuildDetails) => void;
      let reject!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = () => no(new Error("unavailable"));
          })
      );
      tracker.follow(alternate);
      await vi.advanceTimersByTimeAsync(10_000);
      tracker.follow(primary);
      let panelReport: Promise<PanelCompletionDecision> | undefined;
      const observePanel = () => {
        panelReport = tracker.claimPanelCompletion({ notice: { ...alternate, result: "SUCCESS" } });
        return panelReport;
      };
      if (order === "panel first") observePanel();
      void tracker.claimPanelCompletion({ notice: { ...primary, result: "SUCCESS", queueId: 17 } });
      if (order === "known first") observePanel();
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(tracker.count, 1);
      if (response === "stopped")
        tracker.stopFollowingBuild(alternate.environment, alternate.buildUrl);
      if (response === "disposed") tracker.dispose();
      if (response === "error") reject();
      else
        resolve({
          number: 9,
          url: alternate.buildUrl,
          building: false,
          result: "SUCCESS",
          queueId: response === "matching" ? 17 : response === "distinct" ? 18 : undefined
        });
      await vi.advanceTimersByTimeAsync(response === "error" ? 0 : 60_000);
      assert.equal(
        (await panelReport)?.disposition,
        response === "error"
          ? "panel"
          : ["missing", "distinct"].includes(response)
            ? "tracker"
            : "handled"
      );
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        ["matching", "error", "stopped", "disposed"].includes(response) ? 1 : 2
      );
      assert.equal(getBuildDetails.mock.calls.length, 1);
      assert.equal(tracker.count, response === "error" ? 1 : 0);
      tracker.dispose();
    }
  );

  it("leaves a positively identified replacement intact when a cached panel queries or acts on its old run", () => {
    const { tracker } = createHarness([]);
    const old = { ...createBuild(9, "app"), queueId: 17 };
    const replacement = { ...old, queueId: 18 };
    tracker.follow(replacement);
    assert.equal(tracker.getObservedBuildState(old), "conflict");
    tracker.observeRunningBuild(old);
    assert.equal(tracker.follow(old, "configured"), "unidentified");
    tracker.stopFollowingObservedBuild(old);
    assert.equal(window.showWarningMessage.mock.calls.length, 0);
    assert.equal(tracker.count, 1);
    assert.equal(tracker.getObservedBuildState(replacement), "following");
    tracker.stopFollowingObservedBuild(replacement);
    assert.equal(tracker.count, 0);
    tracker.dispose();
  });

  it("stops an exact queue follow without stopping the separate URL-only subscription", () => {
    const { tracker } = createHarness([]);
    const build = createBuild(9, "app");
    const observed = { ...build, queueId: 17 };
    tracker.follow(build);
    tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
    const counts: number[] = [];
    tracker.onDidChange(() => {
      counts.push(tracker.count);
      tracker.observeRunningBuild(observed);
    });
    tracker.stopFollowingObservedBuild(observed);
    assert.deepEqual(counts, [1]);
    assert.equal(tracker.count, 1);
    assert.equal(tracker.getObservedBuildState(observed), "conflict");
    tracker.dispose();
  });

  it.each(
    ["incumbent", "queued", "third", "terminal", "stopped", "disposed"].flatMap((outcome) =>
      [17, 18].map((queueId) => ({ outcome, queueId }))
    )
  )(
    "confirms the current run before a conflicting queue #$queueId handoff ($outcome)",
    async ({ outcome, queueId }) => {
      const build = createBuild(9, "shared");
      const incumbentId = queueId === 17 ? 18 : 17;
      const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
      let confirm!: (details: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirm = resolve;
          })
      );
      tracker.follow({ ...build, queueId: incumbentId });
      getQueueItem.mockResolvedValue({
        id: queueId,
        executable: { number: 9, url: build.buildUrl }
      });
      tracker.followQueueItem({ environment: build.environment, queueId, label: "shared" });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 2);
      assert.ok(tracker.isFollowingQueueItem(build.environment, incumbentId));
      assert.ok(tracker.isFollowingQueueItem(build.environment, queueId));
      assert.equal(getBuildDetails.mock.calls.length, 1);
      assert.equal(getBuildDetails.mock.calls[0][1], build.buildUrl);
      if (outcome === "stopped") tracker.stopFollowingQueueItem(build.environment, queueId);
      if (outcome === "disposed") tracker.dispose();
      confirm({
        url: build.buildUrl,
        number: 9,
        queueId: outcome === "incumbent" ? incumbentId : outcome === "third" ? 19 : queueId,
        building: outcome !== "terminal",
        result: "SUCCESS"
      });
      await vi.advanceTimersByTimeAsync(0);
      const followsQueued = outcome === "queued";
      const followsIncumbent = ["incumbent", "third", "stopped"].includes(outcome);
      assert.equal(tracker.isFollowingQueueItem(build.environment, queueId), followsQueued);
      assert.equal(tracker.isFollowingQueueItem(build.environment, incumbentId), followsIncumbent);
      assert.equal(tracker.count, Number(followsQueued) + Number(followsIncumbent));
      assert.equal(window.showInformationMessage.mock.calls.length, outcome === "terminal" ? 1 : 0);
      tracker.dispose();
    }
  );

  it.each(["missing ID", "request failed", "owner changed", "old incumbent"])(
    "rechecks the exact disputed endpoint after %s",
    async (outcome) => {
      const build = createBuild(9, "shared");
      const { tracker, getQueueItem, getBuildDetails } = createHarness([], {
        initialPollMs: 100,
        maxPollMs: 100
      });
      let resolve!: (details: JenkinsBuildDetails) => void;
      let reject!: (reason: Error) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          })
      );
      const replaced = outcome === "owner changed" || outcome === "old incumbent";
      const replacementId = replaced ? 19 : 18;
      getBuildDetails.mockResolvedValue({
        number: 9,
        url: build.buildUrl,
        queueId: replacementId,
        building: true
      });
      tracker.follow({ ...build, queueId: 18 });
      getQueueItem.mockResolvedValue({ id: 17, executable: { number: 9, url: build.buildUrl } });
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "shared" });
      await vi.advanceTimersByTimeAsync(0);
      if (replaced) {
        tracker.stopFollowingQueueItem(build.environment, 18);
        tracker.follow({ ...build, queueId: 19 });
      }
      if (outcome === "request failed") reject(new Error("temporarily unavailable"));
      else
        resolve({
          number: 9,
          url: build.buildUrl,
          building: true,
          queueId: outcome === "owner changed" ? 17 : outcome === "old incumbent" ? 18 : undefined
        });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 2);
      assert.ok(tracker.isFollowingQueueItem(build.environment, replacementId));
      await vi.advanceTimersByTimeAsync(100);
      assert.equal(getQueueItem.mock.calls.length, 1);
      assert.equal(tracker.count, 1);
      assert.ok(tracker.isFollowingQueueItem(build.environment, replacementId));
      tracker.dispose();
    }
  );

  it.each([17, 18])(
    "preserves the primary endpoint when a late alternate URL now identifies queue %s",
    async (verified) => {
      const primary = createBuild(9, "primary");
      const alternate = createBuild(9, "alternate");
      const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
      let release!: (item: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      getBuildDetails.mockImplementation(async (_env, url) => ({
        number: 9,
        building: true,
        url,
        queueId: url === alternate.buildUrl ? verified : 17
      }));
      tracker.followQueueItem({ environment: primary.environment, queueId: 17, label: "shared" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.observeRunningBuild({ ...primary, queueId: 17 });
      tracker.follow({ ...alternate, queueId: 18 });
      release({ id: 17, executable: { number: 9, url: alternate.buildUrl } });
      await vi.advanceTimersByTimeAsync(0);
      assert.ok(tracker.isFollowingQueueItem(primary.environment, 17));
      assert.ok(tracker.isFollowingBuild(primary.environment, primary.buildUrl));
      assert.equal(tracker.isFollowingQueueItem(primary.environment, 18), verified === 18);
      assert.equal(tracker.getObservedBuildState({ ...alternate, queueId: verified }), "following");
      tracker.dispose();
    }
  );

  it.each([
    ...["old first", "fresh first"].flatMap((order) =>
      ["missing", "old run", "stopped", "disposed"].map((outcome) => ({ order, outcome }))
    ),
    { order: "old first", outcome: "number only" },
    { order: "fresh first", outcome: "number only" }
  ])(
    "confirms queue discovery independently of a pre-discovery poll ($order, $outcome)",
    async ({ order, outcome }) => {
      const build = createBuild(9, "app");
      const queueId = outcome === "number only" ? undefined : 17;
      const { tracker, getBuildDetails, getQueueItem } = createHarness(
        [
          { building: true, queueId },
          { building: false, queueId, result: "SUCCESS" }
        ],
        { initialPollMs: 100, maxPollMs: 100, maxConsecutiveErrors: 1 }
      );
      let old!: () => void;
      let fresh!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            old = () => {
              if (outcome === "old run")
                resolve({ number: 9, url: build.buildUrl, queueId: 18, building: true });
              else reject(new JenkinsRequestError("No such run yet", 404));
            };
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            fresh = () => resolve({ number: 9, url: build.buildUrl, queueId, building: true });
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(100);
      getQueueItem.mockResolvedValue({ id: 17, executable: { number: 9, url: build.buildUrl } });
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      if (outcome === "stopped") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      if (outcome === "disposed") tracker.dispose();
      const [first, second] = order === "old first" ? [old, fresh] : [fresh, old];
      first();
      if (order === "fresh first" && outcome === "number only") {
        await vi.advanceTimersByTimeAsync(120_000);
        assert.equal(tracker.count, 2);
        assert.equal(getBuildDetails.mock.calls.length, 2);
      }
      await vi.advanceTimersByTimeAsync(0);
      second();
      await vi.advanceTimersByTimeAsync(0);
      const active = outcome !== "stopped" && outcome !== "disposed";
      if (active) {
        assert.equal(tracker.count, 1);
        assert.ok(tracker.isFollowingQueueItem(build.environment, 17));
      }
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(tracker.count, 0);
      assert.deepEqual(
        window.showInformationMessage.mock.calls.map(([message]) => message),
        active ? ["app #9 finished: Success."] : []
      );
      assert.equal(getQueueItem.mock.calls.length, 1);
      assert.ok(getBuildDetails.mock.calls.every(([, url]) => url === build.buildUrl));
      tracker.dispose();
    }
  );

  it.each(["verified conflict", "stop queue", "stop direct", "dispose"])(
    "honors %s while a number-only confirmation waits for its competing URL",
    async (action) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails, getQueueItem } = createHarness(
        [{ building: false, result: "SUCCESS" }],
        { initialPollMs: 100, maxPollMs: 100, maxConsecutiveErrors: 1 }
      );
      let finishOld!: (details: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(100);
      getQueueItem.mockResolvedValue({ id: 17, executable: { number: 9, url: build.buildUrl } });
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 2);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      if (action === "stop queue") tracker.stopFollowingQueueItem(build.environment, 17);
      if (action === "stop direct") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      if (action === "dispose") tracker.dispose();
      if (action !== "verified conflict") {
        await vi.advanceTimersByTimeAsync(0);
        assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      }
      finishOld({ number: 9, url: build.buildUrl, queueId: 18, building: true });
      await vi.advanceTimersByTimeAsync(0);
      const keepsDirect = action === "verified conflict" || action === "stop queue";
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 18), keepsDirect);
      assert.equal(tracker.count, keepsDirect ? 1 : 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 0);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      tracker.dispose();
    }
  );

  it.each(["unidentified", "known conflict", "user stop"])(
    "retains queue conflict evidence for a number-only executable on retry (%s)",
    async (previous) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails, getQueueItem } = createHarness(
        [
          { building: true },
          new JenkinsRequestError("Build unavailable", 404),
          { building: false, result: "SUCCESS" }
        ],
        { initialPollMs: 100, maxPollMs: 100, maxConsecutiveErrors: 2 }
      );
      tracker.follow(previous === "known conflict" ? { ...build, queueId: 18 } : build);
      getQueueItem.mockResolvedValue({ id: 17, executable: { number: 9, url: build.buildUrl } });
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 2);
      if (previous === "user stop") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      await vi.advanceTimersByTimeAsync(500);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        previous === "unidentified" ? 1 : 0
      );
      assert.equal(tracker.count, 0);
      assert.equal(getQueueItem.mock.calls.length, 1);
      assert.equal(getBuildDetails.mock.calls.length, previous === "user stop" ? 1 : 3);
      tracker.dispose();
    }
  );

  it.each(["SUCCESS", "FAILURE"])(
    "compares a direct result delivered during executable confirmation against its verified %s outcome",
    async (result) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails, getQueueItem } = createHarness([]);
      let old!: (details: JenkinsBuildDetails) => void;
      let fresh!: (details: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            old = resolve;
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            fresh = resolve;
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10000);
      getQueueItem.mockResolvedValue({ id: 17, executable: { number: 9, url: build.buildUrl } });
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      const terminal = { number: 9, url: build.buildUrl, building: false, result: "SUCCESS" };
      old(terminal);
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      fresh({ ...terminal, result, queueId: 17 });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(window.showWarningMessage.mock.calls.length, result === "FAILURE" ? 1 : 0);
      tracker.dispose();
    }
  );

  it("delivers the old run’s identified result while preserving the confirmed replacement", async () => {
    const build = createBuild(9, "shared");
    const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
    let old!: (details: JenkinsBuildDetails) => void;
    getBuildDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        })
    );
    getBuildDetails.mockResolvedValue({
      number: 9,
      url: build.buildUrl,
      queueId: 17,
      building: true
    });
    tracker.follow({ ...build, queueId: 18 });
    await vi.advanceTimersByTimeAsync(10000);
    getQueueItem.mockResolvedValue({ id: 17, executable: { number: 9, url: build.buildUrl } });
    tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
    await vi.advanceTimersByTimeAsync(1);
    old({ number: 9, url: build.buildUrl, queueId: 18, building: false, result: "SUCCESS" });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(tracker.count, 1);
    assert.ok(tracker.isFollowingQueueItem(build.environment, 17));
    assert.equal(window.showInformationMessage.mock.calls.length, 1);
    tracker.dispose();
  });

  it("keeps a verified replacement through a replayed terminal notice lacking queue identity", () => {
    const { tracker } = createHarness([]);
    const build = createBuild(9, "shared");
    tracker.follow({ ...build, queueId: 18 });
    void tracker.claimPanelCompletion({
      notice: { ...build, result: "SUCCESS" },
      previouslyDelivered: true
    });
    assert.ok(tracker.isFollowingQueueItem(build.environment, 18));
    assert.equal(window.showInformationMessage.mock.calls.length, 0);
    tracker.dispose();
  });

  it.each(
    ["unidentified match", "unidentified replacement", "matching", "replacement"].flatMap(
      (identity) =>
        [false, true].flatMap((queued) =>
          ["panel first", "status first"].map((order) => ({ identity, queued, order }))
        )
    )
  )(
    "routes a positive panel result by queue before URL ($identity, queued=$queued, $order)",
    async ({ identity, queued, order }) => {
      const build = createBuild(9, "app");
      const currentId = identity.includes("replacement") ? 18 : 17;
      const { tracker, getQueueItem } = createHarness(() => ({
        number: 9,
        queueId: currentId,
        building: true
      }));
      getQueueItem.mockResolvedValue({ id: 17 });
      tracker.follow(
        identity.startsWith("unidentified") ? build : { ...build, queueId: currentId }
      );
      if (queued)
        tracker.followQueueItem({
          environment: build.environment,
          queueId: 17,
          label: "panel run"
        });
      if (order === "status first") await vi.advanceTimersByTimeAsync(10_000);
      const claimed =
        (
          await tracker.claimPanelCompletion({
            notice: { ...build, result: "SUCCESS", queueId: 17 }
          })
        ).disposition === "tracker";
      const unidentified = order === "panel first" && identity.startsWith("unidentified");
      assert.equal(claimed, queued || currentId === 17 || unidentified);
      assert.equal(tracker.count, unidentified || currentId !== 17 ? 1 : 0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      if (claimed)
        assert.deepEqual(
          window.showInformationMessage.mock.calls.map((call) => call.slice(1)),
          [["View Build Details", "Preview Log"]]
        );
      else assert.equal(window.showInformationMessage.mock.calls.length, 0);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, currentId === 18 ? 1 : 0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 18), currentId === 18);
      assert.equal(window.showInformationMessage.mock.calls.length, claimed ? 1 : 0);
      tracker.dispose();
    }
  );

  it.each(["matching", "replacement", "missing", "stopped", "disposed"])(
    "checks an unidentified URL before accepting a delayed queue executable (%s)",
    async (outcome) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails, getQueueItem } = createHarness([]);
      let executable!: (item: JenkinsQueueItem) => void;
      let corroborate!: (details: JenkinsBuildDetails) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            executable = resolve;
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            corroborate = resolve;
          })
      );
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "queue run" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.follow(build);
      executable({ id: 17, executable: { number: 9, url: build.buildUrl } });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, 2);
      if (outcome === "stopped") tracker.stopFollowingQueueItem(build.environment, 17);
      if (outcome === "disposed") tracker.dispose();
      corroborate({
        number: 9,
        url: build.buildUrl,
        queueId: outcome === "missing" ? undefined : outcome === "replacement" ? 18 : 17,
        building: true
      });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.count, outcome === "disposed" ? 0 : outcome === "missing" ? 2 : 1);
      assert.equal(
        tracker.isFollowingQueueItem(build.environment, 17),
        outcome === "matching" || outcome === "missing"
      );
      assert.equal(tracker.isFollowingQueueItem(build.environment, 18), outcome === "replacement");
      assert.equal(getQueueItem.mock.calls.length, 1);
      assert.equal(window.showInformationMessage.mock.calls.length, 0);
      tracker.dispose();
    }
  );

  it.each([17, 18])(
    "checks an ambiguous panel result before opening the numbered endpoint owned by queue %s",
    async (current) => {
      const build = createBuild(9, "app");
      const { tracker, actions } = createHarness(() => ({
        queueId: current,
        building: false,
        result: "SUCCESS"
      }));
      window.showInformationMessage.mockResolvedValueOnce("Preview Log");
      tracker.follow(build);
      void tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS", queueId: 17 } });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(actions.previewLog.mock.calls.length, current === 17 ? 1 : 0);
      assert.equal(tracker.count, 1);
      tracker.dispose();
    }
  );

  it.each(["different", "cancelled", "missing"])(
    "releases an exact queued panel completion after its outstanding read is %s",
    async (outcome) => {
      const first = createBuild(9, "previous");
      const disputed = createBuild(9, "current");
      const { tracker, getQueueItem } = createHarness(() => ({
        number: 9,
        queueId: 18,
        building: true
      }));
      let release!: (item: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      tracker.followQueueItem({ environment: first.environment, queueId: 17, label: "queued" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.follow(first);
      void tracker.claimPanelCompletion({ notice: { ...first, result: "SUCCESS" } });
      tracker.follow({ ...disputed, queueId: 18 });
      void tracker.claimPanelCompletion({
        notice: { ...disputed, result: "SUCCESS", queueId: 17 }
      });
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      release(
        outcome === "different"
          ? { id: 17, executable: { number: 9, url: disputed.buildUrl } }
          : { id: 17, cancelled: outcome === "cancelled" }
      );
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(window.showInformationMessage.mock.calls.length, 2);
      assert.ok(tracker.isFollowingQueueItem(disputed.environment, 18));
      assert.equal(tracker.count, 1);
      tracker.dispose();
    }
  );

  it.each(["distinct", "already delivered", "verified alias", "stopped", "disposed"])(
    "preserves the original panel claim across a repeated report during queue handoff (%s)",
    async (outcome) => {
      const first = createBuild(9, "first");
      const second = outcome === "already delivered" ? first : createBuild(9, "second");
      const { tracker, getQueueItem } = createHarness(() => ({
        building: false,
        queueId: 17,
        result: "SUCCESS"
      }));
      let executable!: (item: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            executable = resolve;
          })
      );
      tracker.followQueueItem({ environment: first.environment, queueId: 17, label: "queued" });
      await vi.advanceTimersByTimeAsync(0);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(second.environment, second.buildUrl, "nonce");
      const details = {
        number: 9,
        url: second.buildUrl,
        queueId: 17,
        building: false,
        result: "SUCCESS"
      };
      state.updateDetails({ ...details, building: true });
      tracker.onDidNotifyCompletion((notice) => state.recordFollowedBuildCompletion(notice));
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      tracker.follow(first);
      assert.deepEqual(
        await tracker.claimPanelCompletion({ notice: { ...first, result: "SUCCESS" } }),
        { disposition: "tracker" }
      );
      const original = coordinator.reportCompletion(details);
      assert.deepEqual(await coordinator.reportCompletion(details), {
        disposition: "handled"
      });
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      if (outcome === "stopped") tracker.stopFollowingQueueItem(first.environment, 17);
      if (outcome === "disposed") tracker.dispose();
      executable({
        id: 17,
        executable: {
          number: 9,
          url: outcome === "verified alias" ? first.buildUrl : second.buildUrl
        }
      });
      await vi.advanceTimersByTimeAsync(0);
      assert.deepEqual(await original, {
        disposition: outcome === "distinct" ? "tracker" : "handled"
      });
      assert.deepEqual(
        window.showInformationMessage.mock.calls.map(([message]) => message),
        outcome === "distinct"
          ? ["first #9 finished: Success.", "second #9 finished: Success."]
          : ["first #9 finished: Success."]
      );
      assert.equal(present.mock.calls.length, 0);
      assert.equal(tracker.count, 0);
      tracker.dispose();
    }
  );

  it.each(
    ["old first", "banner first"].flatMap((order) =>
      [
        "404",
        "number-only 404",
        "different running run",
        "same terminal",
        "unknown terminal",
        "different anonymous terminal",
        "different terminal"
      ].map((outcome) => ({ order, outcome }))
    )
  )(
    "preserves an independently verified started choice during an older direct poll ($order, $outcome)",
    async ({ order, outcome }) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails } = createHarness([
        { building: false, result: "SUCCESS", queueId: 17 }
      ]);
      let old!: () => void;
      let fresh!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            old = () => {
              if (outcome.endsWith("404")) reject(new JenkinsRequestError("No such build", 404));
              else
                resolve({
                  number: 9,
                  url: build.buildUrl,
                  queueId:
                    outcome === "same terminal"
                      ? 17
                      : ["unknown terminal", "different anonymous terminal"].includes(outcome)
                        ? undefined
                        : 18,
                  building: outcome === "different running run",
                  result: outcome === "different anonymous terminal" ? "FAILURE" : "SUCCESS"
                });
            };
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            fresh = () =>
              resolve({
                number: 9,
                url: build.buildUrl,
                queueId: outcome === "number-only 404" ? undefined : 17,
                building: !outcome.endsWith("terminal"),
                result: "SUCCESS"
              });
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild({ ...build, queueId: 17 });
      const [first, second] = order === "old first" ? [old, fresh] : [fresh, old];
      first();
      await vi.advanceTimersByTimeAsync(0);
      second();
      await vi.advanceTimersByTimeAsync(0);
      assert.ok(["following", "already-following"].includes(await choice));
      assert.equal(
        tracker.isFollowingQueueItem(build.environment, 17),
        !outcome.endsWith("terminal")
      );
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        order === "old first" && outcome === "different terminal" ? 2 : 1
      );
      if (outcome === "different anonymous terminal")
        assert.equal(window.showWarningMessage.mock.calls.length, order === "old first" ? 1 : 0);
      tracker.dispose();
    }
  );

  it.each(["old first", "confirmation first"])(
    "claims the confirmed terminal run even if an earlier poll bound its queue ID (%s)",
    async (order) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails } = createHarness([
        new JenkinsRequestError("Run was deleted", 404)
      ]);
      let old!: (status: JenkinsBuildDetails) => void;
      let fresh!: (status: JenkinsBuildDetails) => void;
      getBuildDetails
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              old = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              fresh = resolve;
            })
        );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild({ ...build, queueId: 17 });
      const status = { number: 9, url: build.buildUrl, queueId: 17 };
      const begin = () => old({ ...status, building: true });
      const finish = () => fresh({ ...status, building: false, result: "SUCCESS" });
      if (order === "old first") {
        begin();
        await vi.advanceTimersByTimeAsync(0);
        finish();
      } else {
        finish();
        await vi.advanceTimersByTimeAsync(0);
        begin();
      }
      await choice;
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      assert.equal(tracker.count, 0);
      assert.deepEqual(
        window.showInformationMessage.mock.calls.map(([message]) => message),
        ["app #9 finished: Success."]
      );
      tracker.dispose();
    }
  );

  it.each(["stopped", "replaced", "replacement stopped", "disposed"])(
    "does not restart an interrupted banner follow after the earlier direct poll fails (%s)",
    async (action) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails } = createHarness([]);
      let fail!: () => void;
      let verify!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = () => reject(new JenkinsRequestError("Missing", 404));
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            verify = () => resolve({ number: 9, url: build.buildUrl, building: true, queueId: 17 });
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild({ ...build, queueId: 17 });
      if (action === "stopped") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      fail();
      await vi.advanceTimersByTimeAsync(0);
      if (action.startsWith("replace")) tracker.follow({ ...build, queueId: 18 });
      if (action === "replacement stopped") tracker.stopFollowingQueueItem(build.environment, 18);
      if (action === "disposed") tracker.dispose();
      verify();
      assert.equal(await choice, action === "disposed" ? "disposed" : "unidentified");
      assert.equal(tracker.count, action === "replaced" ? 1 : 0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      tracker.dispose();
    }
  );

  it.each(["match", "replacement", "unidentified", "stopped", "disposed", "unavailable"])(
    "verifies a delayed notification against an unidentified current URL: %s",
    async (outcome) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails } = createHarness([]);
      let resolve!: (details: JenkinsBuildDetails) => void;
      let reject!: (reason: Error) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          })
      );
      tracker.follow(build);
      const choice = tracker.followStartedBuild({ ...build, queueId: 17 });
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      if (outcome === "stopped") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      if (outcome === "disposed") tracker.dispose();
      if (outcome === "unavailable") reject(new Error("offline"));
      else
        resolve({
          number: 9,
          url: build.buildUrl,
          building: true,
          queueId: outcome === "unidentified" ? undefined : outcome === "replacement" ? 18 : 17
        });
      assert.equal(
        await choice,
        outcome === "match"
          ? "already-following"
          : outcome === "disposed"
            ? "disposed"
            : "unidentified"
      );
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), outcome === "match");
      assert.equal(tracker.count, ["stopped", "disposed"].includes(outcome) ? 0 : 1);
      if (outcome === "replacement") assert.ok(tracker.isFollowingQueueItem(build.environment, 18));
      tracker.dispose();
    }
  );

  it.each([
    "running",
    "terminal",
    "other result",
    "other queue",
    "missing ID running",
    "missing ID terminal",
    "temporary error",
    "stopped",
    "disposed"
  ])(
    "checks the subscription's status before attributing an unidentified panel result (%s)",
    async (outcome) => {
      const build = createBuild(9, "app");
      const { tracker, getBuildDetails } = createHarness([
        { building: false, queueId: 18, result: "SUCCESS" }
      ]);
      let resolve!: (details: JenkinsBuildDetails) => void;
      let reject!: (reason: Error) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          })
      );
      tracker.follow({ ...build, queueId: 18 });
      const report = tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS" } });
      assert.equal(tracker.count, 1);
      if (outcome === "stopped") tracker.stopFollowingQueueItem(build.environment, 18);
      if (outcome === "disposed") tracker.dispose();
      if (outcome === "temporary error") reject(new Error("offline"));
      else
        resolve({
          number: 9,
          url: build.buildUrl,
          building: outcome.includes("running"),
          queueId: outcome.includes("missing ID") ? undefined : outcome === "other queue" ? 17 : 18,
          result: outcome === "other result" ? "FAILURE" : "SUCCESS"
        });
      const terminal = ["terminal", "missing ID terminal"].includes(outcome);
      const decision = await report;
      assert.equal(
        decision.disposition,
        outcome === "disposed" ? "handled" : terminal ? "tracker" : "panel"
      );
      assert.equal(
        tracker.count,
        terminal || ["stopped", "disposed", "other result"].includes(outcome) ? 0 : 1
      );
      assert.equal(window.showInformationMessage.mock.calls.length, terminal ? 1 : 0);
      if (outcome === "other result") assert.equal(window.showWarningMessage.mock.calls.length, 1);
      if (outcome === "temporary error") {
        tracker.recordPanelCompletion({ ...build, result: "SUCCESS" }, decision);
        await vi.advanceTimersByTimeAsync(10000);
        assert.equal(tracker.count, 0);
        assert.equal(window.showInformationMessage.mock.calls.length, 0);
      }
      tracker.dispose();
    }
  );

  it.each(
    ["queued", "in flight"].flatMap((timing) =>
      [
        "running",
        "terminal",
        "different result",
        "missing ID running",
        "missing ID terminal",
        "other queue",
        "stopped"
      ].map((status) => ({ timing, status }))
    )
  )(
    "corroborates a previous unidentified result before resolving a $timing executable ($status)",
    async ({ timing, status }) => {
      const build = createBuild(9, "app");
      const id = 17;
      const { tracker, getQueueItem, getBuildDetails } = createHarness(() => ({
        number: 9,
        building: status.includes("running"),
        result: status === "different result" ? "FAILURE" : "SUCCESS",
        queueId: status.includes("missing ID") ? undefined : status === "other queue" ? 18 : id
      }));
      let release!: (value: JenkinsQueueItem) => void;
      const executable = { id, executable: { number: 9, url: build.buildUrl } };
      if (timing === "in flight")
        getQueueItem.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve;
            })
        );
      else getQueueItem.mockResolvedValueOnce({ id }).mockResolvedValue(executable);
      tracker.followQueueItem({ environment: build.environment, queueId: id, label: "queued" });
      await vi.advanceTimersByTimeAsync(0);
      tracker.follow(build);
      void tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS" } });
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      if (status === "stopped") tracker.stopFollowingQueueItem(build.environment, id);
      if (timing === "in flight") release(executable);
      await vi.advanceTimersByTimeAsync(timing === "in flight" ? 0 : 10_000);
      assert.equal(tracker.count, status.includes("running") ? 1 : 0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, id), status.includes("running"));
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(
        window.showWarningMessage.mock.calls.length,
        ["different result", "other queue"].includes(status) ? 1 : 0
      );
      if (status === "stopped") assert.equal(getBuildDetails.mock.calls.length, 0);
      tracker.dispose();
    }
  );

  it.each(
    ["known first", "panel first"].flatMap((order) =>
      [
        "already announced",
        "running replacement",
        "different result",
        "confirmed terminal",
        "same queue running after different result",
        "same queue terminal with different result"
      ].map((status) => ({ order, status }))
    )
  )(
    "settles the original panel result against actual status ($order, $status)",
    async ({ order, status }) => {
      const first = { ...createBuild(9, "first"), queueId: 17 };
      const alternate = createBuild(9, "alternate");
      const { tracker, getBuildDetails } = createHarness([]);
      let release!: (details: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      tracker.follow(alternate);
      await vi.advanceTimersByTimeAsync(10000);
      tracker.follow(first);
      if (order === "known first")
        tracker.claimPanelCompletion({ notice: { ...first, result: "SUCCESS", queueId: 17 } });
      const report = tracker.claimPanelCompletion({
        notice: { ...alternate, result: status.startsWith("same queue") ? "FAILURE" : "SUCCESS" }
      });
      if (order === "panel first")
        tracker.claimPanelCompletion({ notice: { ...first, result: "SUCCESS", queueId: 17 } });
      release({
        number: 9,
        url: alternate.buildUrl,
        queueId: status === "already announced" || status.startsWith("same queue") ? 17 : 18,
        building: status === "already announced" || status.includes("running"),
        result:
          status === "different result" || status === "same queue terminal with different result"
            ? "FAILURE"
            : status === "confirmed terminal"
              ? "SUCCESS"
              : undefined
      });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(
        (await report).disposition,
        status === "already announced"
          ? "handled"
          : ["confirmed terminal", "same queue terminal with different result"].includes(status)
            ? "tracker"
            : "panel"
      );
      assert.equal(tracker.count, status === "running replacement" ? 1 : 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        status === "confirmed terminal" ? 2 : 1
      );
      assert.equal(
        window.showWarningMessage.mock.calls.length,
        status === "different result" || status === "same queue terminal with different result"
          ? 1
          : 0
      );
      if (status === "running replacement") {
        assert.ok(tracker.isFollowingQueueItem(alternate.environment, 18));
        getBuildDetails.mockResolvedValueOnce({
          number: 9,
          url: alternate.buildUrl,
          queueId: 18,
          building: false,
          result: "FAILURE"
        });
        await vi.advanceTimersByTimeAsync(30_000);
        assert.equal(tracker.count, 0);
        assert.equal(window.showWarningMessage.mock.calls.length, 1);
      }
      tracker.dispose();
    }
  );

  it("requires matching controller, scope, number, and queue ID for panel aliases", () => {
    const { tracker } = createHarness([]);
    const build = { ...createBuild(9, "app"), queueId: 17 };
    tracker.follow(build);
    const alias = { ...createBuild(9, "alternate"), queueId: 17 };
    for (const observation of [
      { ...alias, queueId: 11 },
      { ...createBuild(10, "alternate"), queueId: 17 },
      { ...alias, environment: { ...build.environment, scope: "workspace" as const } },
      { ...alias, environment: { ...build.environment, environmentId: "different" } },
      { ...alias, environment: { ...build.environment, url: "https://another.test/" } }
    ]) {
      tracker.observeRunningBuild(observation);
      assert.equal(tracker.isFollowingBuild(observation.environment, observation.buildUrl), false);
      assert.ok(tracker.isFollowingBuild(build.environment, build.buildUrl));
    }
    tracker.observeRunningBuild(alias);
    assert.ok(tracker.isFollowingBuild(alias.environment, alias.buildUrl));
    tracker.rejectMismatchedBuild(alias.environment, createBuild(9, "other").buildUrl, 42);
    tracker.rejectMismatchedBuild(alias.environment, alias.buildUrl, 9);
    assert.equal(tracker.count, 1);
    tracker.rejectMismatchedBuild(alias.environment, alias.buildUrl, 42);
    assert.equal(tracker.isFollowingBuild(alias.environment, alias.buildUrl), false);
    assert.equal(tracker.count, 1);
    assert.equal(window.showWarningMessage.mock.calls.length, 0);
    tracker.rejectMismatchedBuild(build.environment, build.buildUrl, 42);
    assert.equal(tracker.count, 0);
    assert.equal(window.showWarningMessage.mock.calls.length, 1);
    assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
    tracker.dispose();
  });

  it.each(["number mismatch", "contradictory terminal", "fresh rebind", "queue ID mismatch"])(
    "keeps the primary poll when the panel invalidates its secondary URL (%s)",
    async (observation) => {
      const build = { ...createBuild(9, "primary"), queueId: 17 };
      const alias = { ...createBuild(9, "plugin"), queueId: 17 };
      const { tracker, getBuildDetails } = createHarness([
        { number: 9, queueId: 17, building: false, result: "FAILURE" }
      ]);
      tracker.follow(build);
      tracker.observeRunningBuild(alias);
      const cached = () => tracker.observeRunningBuild(alias);
      const updated = vi.fn(cached);
      tracker.onDidChange(updated);
      const completion = vi.fn();
      tracker.onDidNotifyCompletion(completion);
      if (observation === "contradictory terminal")
        void tracker.claimPanelCompletion({
          notice: { ...alias, buildNumber: 42, result: "SUCCESS", queueId: 17 }
        });
      else if (observation === "queue ID mismatch") {
        const replacement = { ...alias, queueId: 18 };
        tracker.observeRunningBuild(replacement);
        assert.ok(tracker.isFollowingBuild(alias.environment, alias.buildUrl));
        tracker.observeRunningBuild(replacement, true);
        assert.equal(tracker.getObservedBuildState(replacement), "available");
      } else tracker.rejectMismatchedBuild(alias.environment, alias.buildUrl, 42);
      assert.ok(updated.mock.calls.length);
      assert.equal(tracker.getObservedBuildState(alias), "conflict");
      assert.equal(tracker.isFollowingBuild(alias.environment, alias.buildUrl), false);
      tracker.stopFollowingObservedBuild(alias);
      if (observation === "fresh rebind") {
        tracker.observeRunningBuild(alias, true);
        assert.equal(tracker.getObservedBuildState(alias), "following");
      }
      assert.ok(tracker.isFollowingBuild(build.environment, build.buildUrl));
      assert.ok(tracker.isFollowingQueueItem(build.environment, 17));
      assert.equal(window.showWarningMessage.mock.calls.length, 0);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(getBuildDetails.mock.calls.length, 1);
      assert.equal(getBuildDetails.mock.calls[0][1], build.buildUrl);
      assert.equal(tracker.count, 0);
      assert.equal(completion.mock.calls.length, 1);
      assert.equal(completion.mock.calls[0][0].result, "FAILURE");
      assert.deepEqual(
        completion.mock.calls[0][0].aliases,
        observation === "fresh rebind" ? [alias.buildUrl] : []
      );
      assert.equal(window.showWarningMessage.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it("de-duplicates follows by build URL and runs one poll chain", async () => {
    const { tracker, getBuildDetails } = createHarness(() => ({ building: true }));
    const build = createBuild(42);

    assert.equal(tracker.follow(build), "following");
    assert.equal(tracker.follow({ ...build }), "already-following");
    assert.equal(tracker.count, 1);

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(getBuildDetails.mock.calls.length, 1);
    assert.deepEqual(getBuildDetails.mock.calls[0], [
      build.environment,
      build.buildUrl,
      { statusOnly: true, bypassCache: true }
    ]);
    tracker.dispose();
  });

  it("distinguishes tracker delivery, panel delivery, and an existing completion claim", async () => {
    const build = createBuild(42, "app");
    const { tracker } = createHarness([]);
    const report = { notice: { ...build, result: "SUCCESS", queueId: 17 } };
    assert.deepEqual(await tracker.claimPanelCompletion(report), { disposition: "panel" });
    assert.deepEqual(await tracker.claimPanelCompletion({ ...report, previouslyDelivered: true }), {
      disposition: "handled"
    });
    tracker.follow(build);
    assert.deepEqual(await tracker.claimPanelCompletion(report), { disposition: "tracker" });
    assert.deepEqual(await tracker.claimPanelCompletion(report), { disposition: "handled" });
    assert.equal(window.showInformationMessage.mock.calls.length, 1);
    tracker.dispose();
    assert.deepEqual(await tracker.claimPanelCompletion(report), { disposition: "handled" });
  });

  it("accepts an in-flight running poll requested after the terminal panel read", async () => {
    const build = createBuild(42, "app");
    const requestOrder = nextBuildObservationOrder();
    const { tracker, getBuildDetails } = createHarness([]);
    let reply!: (details: JenkinsBuildDetails) => void;
    getBuildDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        })
    );
    tracker.follow(build);
    await vi.advanceTimersByTimeAsync(10_000);
    const verifying = tracker.claimPanelCompletion({
      notice: { ...build, requestOrder, result: "SUCCESS" }
    });
    reply({ number: 42, url: build.buildUrl, building: true, queueId: 18 });
    assert.deepEqual(await verifying, { disposition: "panel", verifiedRunningQueueId: 18 });
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(getBuildDetails.mock.calls.length, 1);
    assert.ok(tracker.isFollowingQueueItem(build.environment, 18));
    tracker.dispose();
  });

  it.each(
    [17, undefined].flatMap((oldQueueId) =>
      [
        "matching",
        "matching with ID",
        "different outcome",
        "different outcome without ID",
        "still running",
        "unavailable",
        "missing status",
        "suppressed unavailable",
        "suppressed unknown",
        "stopped",
        "disposed"
      ].map((outcome) => ({ oldQueueId, outcome }))
    )
  )(
    "rechecks a terminal panel observation after an older running poll (old queue $oldQueueId, $outcome)",
    async ({ oldQueueId, outcome }) => {
      const build = createBuild(42, "app");
      const run = { number: 42, url: build.buildUrl };
      const { tracker, getBuildDetails } = createHarness([]);
      let replyToOldPoll!: (details: JenkinsBuildDetails) => void;
      let verify!: (details: JenkinsBuildDetails) => void;
      let unavailable!: (reason: Error) => void;
      getBuildDetails
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              replyToOldPoll = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              verify = resolve;
              unavailable = reject;
            })
        )
        .mockResolvedValue({
          ...run,
          building: false,
          queueId: 18,
          result: outcome === "still running" ? "FAILURE" : "SUCCESS"
        });
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      state.updateDetails({ ...run, building: true });
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
      tracker.onDidNotifyCompletion((notice) => {
        if (notice.source !== "panel") state.recordFollowedBuildCompletion(notice);
      });
      try {
        tracker.follow(build);
        await vi.advanceTimersByTimeAsync(10_000);
        const details = await readPanelBuildDetails(async () => ({
          ...run,
          building: false,
          result: "SUCCESS"
        }));
        const notifying = runtime.showCompletionToast(details);
        if (outcome === "stopped") tracker.stopFollowingBuild(build.environment, build.buildUrl);
        replyToOldPoll({ ...run, building: true, queueId: oldQueueId });
        await vi.advanceTimersByTimeAsync(1000);
        assert.equal(window.showInformationMessage.mock.calls.length, 0);
        assert.equal(getBuildDetails.mock.calls.length, outcome === "stopped" ? 1 : 2);
        if (outcome !== "stopped") {
          await vi.advanceTimersByTimeAsync(30_000);
          assert.equal(getBuildDetails.mock.calls.length, 2);
          if (outcome === "disposed") tracker.dispose();
          if (outcome.startsWith("suppressed"))
            state.updateDetails(
              await readPanelBuildDetails(async () => ({ ...run, building: true }))
            );
          if (outcome === "unavailable" || outcome === "suppressed unavailable")
            unavailable(new Error("offline"));
          else if (outcome === "missing status" || outcome === "suppressed unknown") verify(run);
          else
            verify({
              ...run,
              building: outcome === "still running",
              queueId: outcome === "matching" || outcome.endsWith("without ID") ? undefined : 18,
              result: outcome.startsWith("different outcome")
                ? "FAILURE"
                : outcome === "still running"
                  ? undefined
                  : "SUCCESS"
            });
        }
        await notifying;
        await vi.advanceTimersByTimeAsync(60_000);
        const stopped = outcome === "stopped" || outcome === "disposed";
        const separate = outcome.startsWith("different outcome") || outcome === "still running";
        assert.equal(tracker.count, 0);
        assert.equal(window.showInformationMessage.mock.calls.length, stopped ? 0 : 1);
        assert.equal(window.showWarningMessage.mock.calls.length, separate ? 1 : 0);
        assert.equal(
          getBuildDetails.mock.calls.length,
          outcome === "stopped"
            ? 1
            : [
                  "still running",
                  "unavailable",
                  "missing status",
                  "suppressed unknown",
                  "suppressed unavailable"
                ].includes(outcome)
              ? 3
              : 2
        );
        if (
          outcome === "matching" ||
          outcome === "matching with ID" ||
          outcome.startsWith("suppressed")
        )
          assert.deepEqual(window.showInformationMessage.mock.calls[0].slice(1), [
            "View Build Details",
            "Preview Log"
          ]);
      } finally {
        runtime.dispose();
        tracker.dispose();
      }
    }
  );

  it.each(
    ["before notice", "after notice"].flatMap((timing) =>
      ["number only", "different result", "matching ID", "other ID"].flatMap((status) =>
        ["running", "terminal"].map((first) => ({ timing, status, first }))
      )
    )
  )(
    "checks an announced numbered result against a $first read requested $timing ($status)",
    async ({ timing, status, first }) => {
      const build = createBuild(42, "app");
      const { tracker, getBuildDetails } = createHarness([]);
      const final = {
        number: 42,
        url: build.buildUrl,
        building: false,
        result: status === "different result" ? "FAILURE" : "SUCCESS",
        queueId: status === "matching ID" ? 17 : status === "other ID" ? 18 : undefined
      };
      let release!: (details: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      getBuildDetails.mockResolvedValue(final);
      tracker.follow(build);
      if (timing === "before notice") await vi.advanceTimersByTimeAsync(10_000);
      void tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS", queueId: 17 } });
      if (timing === "after notice") await vi.advanceTimersByTimeAsync(10_000);
      release(first === "running" ? { number: 42, url: build.buildUrl, building: true } : final);
      await vi.advanceTimersByTimeAsync(0);
      if (first === "running") {
        assert.equal(tracker.count, 1);
        await vi.advanceTimersByTimeAsync(30_000);
      }
      assert.equal(tracker.count, 0);
      const replacement =
        status === "other ID" ||
        status === "different result" ||
        (status === "number only" && timing === "after notice" && first === "running");
      assert.equal(
        window.showInformationMessage.mock.calls.length +
          window.showWarningMessage.mock.calls.length,
        replacement ? 2 : 1
      );
      tracker.dispose();
    }
  );

  it.each(
    [false, true].flatMap((permalink) => [false, true].map((queued) => ({ permalink, queued })))
  )(
    "matches the resolved numbered Run while preserving a sibling with the same number (permalink=$permalink, queued=$queued)",
    async ({ permalink, queued }) => {
      const build = createBuild(42, "first");
      const sibling = createBuild(42, "second");
      const { tracker } = createHarness(() => ({ building: false, result: "SUCCESS" }));
      const events: FollowedBuildCompletion[] = [];
      tracker.onDidNotifyCompletion((event) => {
        events.push(event);
      });
      tracker.follow(build);
      tracker.follow(sibling);
      if (queued)
        tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "first" });
      tracker.claimPanelCompletion({
        notice: {
          ...build,
          observedUrl: permalink ? new URL("../lastBuild/", build.buildUrl).href : build.buildUrl,
          result: "SUCCESS",
          queueId: 17
        }
      });
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      assert.deepEqual(
        window.showInformationMessage.mock.calls.map(([message]) => message),
        ["first #42 finished: Success.", "second #42 finished: Success."]
      );
      const orders = events
        .filter((event) => event.buildUrl === build.buildUrl)
        .map((event) => event.noticeOrder);
      assert.ok(orders[0]);
      assert.equal(new Set(orders).size, 1);
      tracker.dispose();
    }
  );

  it.each([
    "panel first",
    "tracker first",
    "identified panel first",
    "identified panel second",
    "identified panel first with different result",
    "identified panel second with different result",
    "stopped",
    "unfollowed",
    "queued with ID",
    "queued without ID"
  ] as const)("shows one completion notification with Build Details open (%s)", async (order) => {
    // Exercise a numbered plugin endpoint shared by the tree, queue executable, and panel.
    const build = {
      ...createBuild(42),
      buildUrl: "https://jenkins.example/plugin/example/runs/42/"
    };
    const details = {
      number: 42,
      url: build.buildUrl,
      queueId: order === "queued with ID" || order.startsWith("identified panel") ? 2 : undefined,
      displayName: "#42",
      building: false,
      result: "SUCCESS"
    };
    const { tracker, getQueueItem } = createHarness([
      {
        ...details,
        queueId: order.startsWith("identified panel") ? undefined : details.queueId,
        result: order.endsWith("different result") ? "FAILURE" : details.result
      }
    ]);
    const state = new BuildDetailsPanelState();
    state.resetForLoad(build.environment, build.buildUrl, "nonce");
    state.updateDetails({ ...details, building: true });
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
    const subscription = tracker.onDidNotifyCompletion((target) =>
      state.recordFollowedBuildCompletion(target)
    );
    try {
      if (order === "queued with ID" || order === "queued without ID") {
        getQueueItem.mockResolvedValue({
          id: 2,
          executable: { number: 42, url: "plugin/example/runs/42/" }
        });
        tracker.followQueueItem(queueItem(2));
      } else if (order !== "unfollowed") {
        tracker.follow(build);
      }
      if (order === "stopped") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      if (order === "tracker first" || order.startsWith("identified panel second"))
        await vi.advanceTimersByTimeAsync(10_000);
      await runtime.showCompletionToast(details);
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showWarningMessage.mock.calls.length,
        order.endsWith("different result") ? 1 : 0
      );
      const owned =
        order === "panel first" ||
        order === "tracker first" ||
        (order.startsWith("identified panel") &&
          order !== "identified panel second with different result") ||
        order === "queued with ID";
      assert.deepEqual(
        window.showInformationMessage.mock.calls[0].slice(1),
        owned ? ["View Build Details", "Preview Log"] : ["Open in Jenkins"]
      );
    } finally {
      subscription.dispose();
      runtime.dispose();
      tracker.dispose();
    }
  });

  it.each([
    { first: "panel", parallel: false },
    { first: "panel", parallel: true },
    { first: "handed-off poll", parallel: false },
    { first: "handed-off poll", parallel: true },
    { first: "verified alias without queue metadata", parallel: false },
    { first: "alias verified after completion", parallel: true },
    { first: "direct poll", parallel: true }
  ])(
    "claims one result across distinct numbered plugin URLs ($first first, parallel=$parallel)",
    async ({ first, parallel }) => {
      const number = 42;
      const queueId = 17;
      const executable = "https://jenkins.example/job/team/job/app/42/";
      const panel = "https://jenkins.example/plugin/example/runs/42/";
      const build = { ...createBuild(number), buildUrl: panel };
      const details = {
        number,
        queueId: first.includes("verified") ? undefined : queueId,
        url: panel,
        building: false,
        result: "SUCCESS"
      };
      let panelIdentified = false;
      let finishingUrl: string | undefined;
      const { tracker, getQueueItem } = createHarness((url) => ({
        ...details,
        // The distinct direct endpoint may still lack queue metadata when the panel identifies it.
        queueId:
          first === "handed-off poll" && url === panel && !panelIdentified ? undefined : queueId,
        building: url !== finishingUrl
      }));
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, panel, "token");
      state.updateDetails({ ...details, building: true });
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
      const subscription = tracker.onDidNotifyCompletion((notice) =>
        state.recordFollowedBuildCompletion(notice)
      );
      getQueueItem.mockResolvedValue({ id: queueId, executable: { number, url: executable } });
      tracker.followQueueItem(queueItem(queueId));
      if (parallel) tracker.follow(build, "configured");
      if (first === "verified alias without queue metadata") {
        await vi.advanceTimersByTimeAsync(2);
        // Notify When Finished verified the alternate numbered URL from the queue origin.
        tracker.follow({ ...build, queueId }, "configured");
        assert.ok(tracker.isFollowingBuild(environment, panel, "configured"));
        finishingUrl = executable;
        await vi.advanceTimersByTimeAsync(30_000);
        assert.equal(tracker.count, 0);
      } else if (first === "alias verified after completion") {
        finishingUrl = executable;
        await vi.advanceTimersByTimeAsync(2);
        assert.equal(tracker.count, 1);
        await vi.advanceTimersByTimeAsync(10_000);
        assert.equal(tracker.count, 0);
      } else if (first === "handed-off poll") finishingUrl = executable;
      else if (first === "direct poll") finishingUrl = panel;
      await vi.advanceTimersByTimeAsync(first === "direct poll" ? 10_000 : 2);
      await runtime.showCompletionToast(details);
      panelIdentified = true;
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.deepEqual(window.showInformationMessage.mock.calls[0].slice(1), [
        "View Build Details",
        "Preview Log"
      ]);
      subscription.dispose();
      runtime.dispose();
      tracker.dispose();
    }
  );

  it.each([
    { secondQueue: 17, notices: 1 },
    { secondQueue: 18, notices: 2 }
  ])(
    "waits for positive queue identity on a concurrent direct follow ($secondQueue)",
    async ({ secondQueue, notices }) => {
      const executable = "https://jenkins.example/job/app/42/";
      const other = "https://jenkins.example/plugin/runs/42/";
      const { tracker, getQueueItem } = createHarness((url) => ({
        number: 42,
        building: false,
        result: "SUCCESS",
        queueId: url === executable ? undefined : secondQueue
      }));
      getQueueItem.mockResolvedValue({ id: 17, executable: { number: 42, url: executable } });
      tracker.followQueueItem(queueItem(17));
      tracker.follow({ ...createBuild(42), buildUrl: other }, "configured");
      await vi.advanceTimersByTimeAsync(2);
      assert.equal(tracker.count, 1);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, notices);
      tracker.dispose();
    }
  );

  it.each([
    { queueFirst: true, stop: "alias" },
    { queueFirst: true, stop: "picker" },
    { queueFirst: false, stop: "queue" },
    { queueFirst: false, stop: "finish" }
  ])(
    "merges live aliases into one poll chain (queue first=$queueFirst, stop=$stop)",
    async ({ queueFirst, stop }) => {
      const primary = "https://jenkins.example/job/app/42/";
      const alternate = "https://jenkins.example/plugin/numbered/42/";
      let finished = false;
      const { tracker, getQueueItem, getBuildDetails, actions } = createHarness(
        () => ({ number: 42, queueId: 17, building: !finished, result: "SUCCESS" }),
        { initialPollMs: 100, maxPollMs: 100 }
      );
      const queued = { id: 17, executable: { number: 42, url: primary } };
      let release = () => {};
      getQueueItem.mockImplementationOnce(() =>
        queueFirst
          ? Promise.resolve(queued)
          : new Promise((resolve) => {
              release = () => resolve(queued);
            })
      );
      tracker.followQueueItem(queueItem(17));
      tracker.follow({ ...createBuild(42), buildUrl: alternate }, "configured");
      const selecting = tracker.showFollowedBuilds();
      // Select the row that will be absorbed: either the direct run or the unresolved queue.
      picker.select(queueFirst ? 1 : 0);
      await Promise.resolve();
      const actionsPicker = picker;
      await vi.advanceTimersByTimeAsync(101);
      assert.equal(tracker.count, 1);
      release();
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(tracker.isFollowingQueueItem(environment, 17), true);
      assert.equal(tracker.isFollowingBuild(environment, primary), true);
      assert.equal(tracker.isFollowingBuild(environment, alternate, "configured"), true);
      assert.equal(
        tracker.follow({ ...createBuild(42), buildUrl: alternate }, "configured"),
        "already-following"
      );
      assert.deepEqual(
        actionsPicker.items.map((item) => item.label),
        ["Open Build Details", "Stop following"]
      );
      getBuildDetails.mockClear();
      await vi.advanceTimersByTimeAsync(300);
      assert.equal(getBuildDetails.mock.calls.length, 3);
      assert.deepEqual(
        new Set(getBuildDetails.mock.calls.map(([, url]) => url)),
        new Set([queueFirst ? primary : alternate])
      );
      if (stop === "picker") actionsPicker.select(1);
      else if (stop === "alias") tracker.stopFollowingBuild(environment, alternate, "configured");
      else if (stop === "queue") tracker.stopFollowingQueueItem(environment, 17);
      else {
        finished = true;
        await vi.advanceTimersByTimeAsync(100);
        assert.equal(actions.refreshEnvironment.mock.calls.length, 1);
      }
      await selecting;
      assert.equal(tracker.count, 0);
      assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
      assert.equal(tracker.isFollowingBuild(environment, primary), false);
      assert.equal(tracker.isFollowingBuild(environment, alternate, "configured"), false);
      getBuildDetails.mockClear();
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(getBuildDetails.mock.calls.length, 0);
      tracker.dispose();
    }
  );

  it.each(["queue ID", "build number"] as const)(
    "stops on a changed %s in a terminal status response",
    async (changed) => {
      const { tracker, actions } = createHarness([
        { number: 42, queueId: 17, building: true },
        {
          number: changed === "build number" ? 43 : 42,
          queueId: changed === "queue ID" ? 18 : 17,
          building: false,
          result: "SUCCESS"
        }
      ]);
      const notify = vi.fn();
      tracker.onDidNotifyCompletion(notify);
      tracker.follow(createBuild(42));
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(tracker.count, 0);
      assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
      assert.equal(notify.mock.calls.length, 0);
      assert.equal(actions.refreshEnvironment.mock.calls.length, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 0);
      assert.equal(window.showWarningMessage.mock.calls.length, 1);
      assert.match(
        String(window.showWarningMessage.mock.calls[0][0]),
        /Stopped following .*different build identity/
      );
      tracker.dispose();
    }
  );

  it.each(["queue ID", "build number"] as const)(
    "rejects a panel completion with a contradictory %s at a followed URL",
    async (changed) => {
      const build = createBuild(42);
      const { tracker, actions } = createHarness([{ number: 42, queueId: 17, building: true }]);
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const handled = tracker.claimPanelCompletion({
        notice: {
          ...build,
          buildNumber: changed === "build number" ? 43 : 42,
          result: "SUCCESS",
          queueId: changed === "queue ID" ? 18 : 17
        }
      });
      assert.equal((await handled).disposition, changed === "build number" ? "handled" : "panel");
      assert.equal(tracker.count, changed === "queue ID" ? 1 : 0);
      assert.equal(actions.refreshEnvironment.mock.calls.length, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 0);
      if (changed === "queue ID") {
        assert.ok(tracker.isFollowingQueueItem(build.environment, 17));
        assert.equal(window.showWarningMessage.mock.calls.length, 0);
      } else
        assert.match(
          String(window.showWarningMessage.mock.calls[0][0]),
          /different build identity/
        );
      tracker.dispose();
    }
  );

  it("merges two directly followed running URLs after their first status reads verify the same run", async () => {
    const { tracker, getBuildDetails } = createHarness(
      () => ({ number: 42, queueId: 17, building: true }),
      { initialPollMs: 100, maxPollMs: 100 }
    );
    const build = { ...createBuild(42), buildUrl: "https://jenkins.example/job/app/42/" };
    const alias = { ...build, buildUrl: "https://jenkins.example/plugin/numbered/42/" };
    tracker.follow(build);
    tracker.follow(alias, "configured");
    await vi.advanceTimersByTimeAsync(100);
    assert.equal(tracker.count, 1);
    assert.equal(tracker.followQueueItem(queueItem(17)), false);
    assert.equal(tracker.isFollowingBuild(environment, alias.buildUrl, "configured"), true);
    await vi.advanceTimersByTimeAsync(300);
    assert.equal(getBuildDetails.mock.calls.length, 5);
    tracker.stopFollowingBuild(environment, alias.buildUrl, "configured");
    assert.equal(tracker.isFollowingBuild(environment, build.buildUrl), false);
    assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
    tracker.dispose();
  });

  it("isolates matching queue IDs by run number, scope, environment ID and controller URL", async () => {
    const { tracker, getQueueItem } = createHarness([{ building: true }]);
    const build = {
      ...createBuild(42),
      buildUrl: "https://jenkins.example/plugin/example/runs/42/"
    };
    getQueueItem.mockResolvedValue({ id: 17, executable: { number: 42, url: "job/app/42/" } });
    tracker.followQueueItem(queueItem(17));
    await vi.advanceTimersByTimeAsync(2);
    const mismatches = [
      { ...build, buildNumber: 43, buildUrl: build.buildUrl.replace("42", "43") },
      { ...build, environment: { ...environment, environmentId: "other" } },
      { ...build, environment: { ...environment, scope: "workspace" as const } },
      { ...build, environment: { ...environment, url: "https://other-ci/" } }
    ];
    for (const other of mismatches) {
      assert.equal(
        (
          await tracker.claimPanelCompletion({
            notice: { ...other, result: "SUCCESS", queueId: 17 }
          })
        ).disposition,
        "panel"
      );
      assert.equal(tracker.count, 1);
    }
    assert.equal(
      (await tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS", queueId: 16 } }))
        .disposition,
      "panel"
    );
    assert.equal(
      (await tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS", queueId: 17 } }))
        .disposition,
      "tracker"
    );
    assert.equal(tracker.count, 0);
    tracker.dispose();
  });

  it.each(["configured build", "relative executable", "relative task"])(
    "keeps the literal view endpoint for polling and actions from a %s",
    async (source) => {
      const { tracker, getBuildDetails, actions, getQueueItem } = createHarness([
        { number: 13, building: true },
        { number: 13, building: false, result: "SUCCESS" },
        { number: 13, building: false, result: "SUCCESS" }
      ]);
      const path = "view/team/job/app/13/";
      const url = new URL(path, environment.url).href;
      const build = { ...createBuild(13), buildUrl: url };
      window.showInformationMessage.mockResolvedValueOnce("Preview Log");
      if (source === "configured build") tracker.follow(build, "configured");
      else {
        getQueueItem.mockResolvedValue(
          source === "relative executable"
            ? { id: 17, executable: { number: 13, url: path } }
            : { id: 17, executable: { number: 13 }, task: { url: "view/team/job/app/" } }
        );
        tracker.followQueueItem(queueItem(17));
        await vi.advanceTimersByTimeAsync(2);
      }
      assert.equal(
        tracker.follow({ ...build, buildUrl: new URL("job/app/13/", environment.url).href }),
        "already-following"
      );
      await vi.advanceTimersByTimeAsync(30_000);
      assert.deepEqual(
        getBuildDetails.mock.calls.map(([, requestUrl]) => requestUrl),
        [url, url, url]
      );
      assert.equal(actions.previewLog.mock.calls[0][0].buildUrl, url);
      tracker.dispose();
    }
  );

  it("clears unresolved completion notices when a new load supersedes the old one", () => {
    const build = createBuild(42, "example");
    const state = new BuildDetailsPanelState();
    state.resetForLoad(build.environment, build.buildUrl, "superseded");
    state.recordFollowedBuildCompletion(build);
    state.resetForLoad(build.environment, build.buildUrl.replace("/42/", "/lastBuild/"), "current");
    state.recordFollowedBuildCompletion(createBuild(43, "example"));
    const details = { number: 42, url: build.buildUrl, building: true };
    state.updateDetails(details);
    assert.equal(state.hasCompletionNotice(details), false);
  });

  it("hands a relative numbered plugin executable to the configured controller", async () => {
    const { tracker, getBuildDetails, getQueueItem } = createHarness([
      { building: false, result: "SUCCESS" }
    ]);
    const env = { ...environment, url: "https://jenkins.example/ci/" };
    const path = "plugin/example/runs/42/";
    getQueueItem.mockResolvedValue({ id: 2, executable: { number: 42, url: path } });
    tracker.followQueueItem({ ...queueItem(2), environment: env });
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      [`${env.url}${path}`]
    );
    assert.equal(window.showWarningMessage.mock.calls.length, 0);
    assert.equal(window.showInformationMessage.mock.calls.length, 1);
    tracker.dispose();
  });

  it.each(
    ["/", "/ci/", "/view/", "/job/"]
      .flatMap((base) =>
        ["plugin/example", "custom-runs/example"].map((prefix) => ({ base, prefix }))
      )
      .concat([
        { base: "/view/", prefix: "custom-runs" },
        { base: "/job/", prefix: "custom-runs" }
      ])
  )(
    "keeps a $prefix executable under $base distinct from the classic run with the same suffix",
    async ({ base, prefix }) => {
      const { tracker, getBuildDetails, getQueueItem } = createHarness(() => ({ building: true }));
      const env = { ...environment, url: `https://jenkins.example${base}` };
      const classicJob =
        base === "/job/" && prefix === "custom-runs" ? "job/custom-runs/job/app/" : "job/app/";
      const classic = {
        ...createBuild(42),
        environment: env,
        buildUrl: `${env.url}${classicJob}42/`
      };
      const pluginPath = `${base}${prefix}/job/app/42/`;
      const pluginUrl = new URL(pluginPath, env.url).href;
      const reported = prefix === "custom-runs" ? `${prefix}/job/app/42/` : pluginPath;
      getQueueItem.mockResolvedValue({ id: 2, executable: { number: 42, url: reported } });
      tracker.follow(classic);
      tracker.followQueueItem({ ...queueItem(2), environment: env });
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 2);
      assert.equal(tracker.isFollowingBuild(env, pluginUrl, "configured"), true);
      assert.deepEqual(
        new Set(getBuildDetails.mock.calls.map(([, url]) => url)),
        new Set([classic.buildUrl, pluginUrl])
      );
      tracker.stopFollowingBuild(env, pluginUrl, "configured");
      assert.equal(tracker.isFollowingBuild(env, reported), false);
      assert.equal(tracker.isFollowingBuild(env, pluginUrl, "configured"), false);
      assert.equal(tracker.isFollowingBuild(env, classic.buildUrl), true);
      tracker.dispose();
    }
  );

  it("uses the caller's URL source when a reported tree row equals an opaque public endpoint", async () => {
    const { tracker, getBuildDetails, getQueueItem } = createHarness(() => ({ building: true }));
    const env = { ...environment, url: "https://ci/job/" };
    const path = "custom-runs/job/app/42/";
    const url = `${env.url}${path}`;
    const classic = `${env.url}job/${path}`;
    const build = { ...createBuild(42), environment: env, buildUrl: url };
    getQueueItem.mockResolvedValue({ id: 2, executable: { number: 42, url: path } });
    tracker.followQueueItem({ ...queueItem(2), environment: env });
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(tracker.isFollowingBuild(env, url), false);
    tracker.stopFollowingBuild(env, url);
    assert.equal(tracker.follow(build, "configured"), "already-following");
    assert.equal(tracker.follow(build), "following");
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(
      new Set(getBuildDetails.mock.calls.map(([, url]) => url)),
      new Set([url, classic])
    );
    tracker.stopFollowingBuild(env, url);
    assert.equal(tracker.isFollowingBuild(env, url), false);
    assert.equal(tracker.isFollowingBuild(env, url, "configured"), true);
    tracker.dispose();
  });

  it("keeps a confirmed custom view action separate from the classic build beneath its suffix", async () => {
    const { tracker, getBuildDetails } = createHarness(() => ({ building: true }));
    const classic = createBuild(42, "app");
    const plugin = {
      ...classic,
      buildUrl: `${classic.environment.url}view/team/custom-runs/job/app/42/`
    };
    assert.equal(tracker.follow(classic), "following");
    assert.equal(tracker.follow(plugin, "configured"), "following");
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(
      new Set(getBuildDetails.mock.calls.map(([, url]) => url)),
      new Set([classic.buildUrl, plugin.buildUrl])
    );
    tracker.stopFollowingBuild(plugin.environment, plugin.buildUrl, "configured");
    assert.equal(tracker.isFollowingBuild(classic.environment, classic.buildUrl), true);
    tracker.dispose();
  });

  it("shows an info message and refreshes the environment when a build succeeds", async () => {
    const { tracker, actions } = createHarness([
      { building: true },
      { building: false, result: "SUCCESS" }
    ]);
    tracker.follow(createBuild(42));

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(window.showInformationMessage.mock.calls.length, 0);

    await vi.advanceTimersByTimeAsync(15_000);
    assert.deepEqual(window.showInformationMessage.mock.calls[0], [
      "folder/job #42 finished: Success.",
      "View Build Details",
      "Preview Log"
    ]);
    assert.equal(window.showWarningMessage.mock.calls.length, 0);
    assert.deepEqual(actions.refreshEnvironment.mock.calls, [["env-1"]]);
    assert.equal(tracker.count, 0);
  });

  it("shows a warning message for failed and unstable builds", async () => {
    const results: Record<string, string> = {
      "https://jenkins.example/job/folder/job/1/": "FAILURE",
      "https://jenkins.example/job/folder/job/2/": "UNSTABLE"
    };
    const { tracker } = createHarness((url) => ({ building: false, result: results[url] }));
    tracker.follow(createBuild(1));
    tracker.follow(createBuild(2));

    await vi.advanceTimersByTimeAsync(10_000);
    const messages = window.showWarningMessage.mock.calls.map((call) => call[0]);
    assert.deepEqual(messages.sort(), [
      "folder/job #1 finished: Failed.",
      "folder/job #2 finished: Unstable."
    ]);
    assert.equal(window.showInformationMessage.mock.calls.length, 0);
  });

  it.each(["View Build Details", "Preview Log"])(
    "checks the completed run's queue ID when %s is selected after the URL was reused",
    async (action) => {
      let currentId = 17;
      const build = createBuild(42, "app");
      const { tracker, actions } = createHarness(() => ({
        queueId: currentId,
        building: currentId === 18,
        result: currentId === 17 ? "SUCCESS" : undefined
      }));
      let choose!: (action: string) => void;
      window.showInformationMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          })
      );
      tracker.follow({ ...build, queueId: 17 });
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      currentId = 18;
      tracker.follow({ ...build, queueId: 18 });
      choose(action);
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(actions.previewLog.mock.calls.length, 0);
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      assert.match(String(window.showWarningMessage.mock.calls.at(-1)?.[0]), /could not confirm/);
      assert.ok(tracker.isFollowingQueueItem(build.environment, 18));
      tracker.dispose();
    }
  );

  it("passes a verified terminal queue identity to the log preview", async () => {
    const { tracker, actions } = createHarness(() => ({
      building: false,
      result: "SUCCESS",
      queueId: 17
    }));
    const build = createBuild(7);
    window.showInformationMessage.mockResolvedValueOnce("Preview Log");
    tracker.follow(build);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(actions.previewLog.mock.calls, [
      [{ ...build, queueId: 17, requireQueueId: true, completion: { result: "SUCCESS" } }]
    ]);
    tracker.dispose();
  });

  it("dispatches the notification actions", async () => {
    const { tracker, actions } = createHarness(() => ({ building: false, result: "SUCCESS" }));
    window.showInformationMessage
      .mockResolvedValueOnce("View Build Details")
      .mockResolvedValueOnce("Preview Log");
    const first = createBuild(1);
    const second = createBuild(2);

    tracker.follow(first);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(actions.showBuildDetails.mock.calls, [
      [{ ...first, completion: { result: "SUCCESS" } }]
    ]);
    assert.equal(actions.previewLog.mock.calls.length, 0);

    tracker.follow(second);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(actions.previewLog.mock.calls, [
      [{ ...second, completion: { result: "SUCCESS" } }]
    ]);
  });

  it.each(
    ["tracker", "standalone panel"].flatMap((source) =>
      ["before notice", "after notice", "cached"].flatMap((timing) =>
        [17, undefined].map((queueId) => ({ source, timing, queueId }))
      )
    )
  )(
    "orders a delayed running panel response against a $source result ($timing, queue $queueId)",
    async ({ source, timing, queueId }) => {
      const build = createBuild(42, "app");
      const { tracker } = createHarness(() => ({ building: false, result: "SUCCESS" }));
      const earlyOrder = nextBuildObservationOrder();
      let notice: FollowedBuildCompletion | undefined;
      tracker.onDidNotifyCompletion((event) => {
        notice = event;
      });
      if (source === "tracker") {
        tracker.follow(build);
        void tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS" } });
      } else tracker.recordPanelCompletion({ ...build, result: "SUCCESS" });
      assert.ok(notice?.noticeOrder && notice.noticeOrder > earlyOrder);
      const requestOrder = timing === "before notice" ? earlyOrder : nextBuildObservationOrder();
      const original = window.showInformationMessage.mock.calls.length;
      await tracker.followStartedBuild(build, "configured", undefined, notice);
      tracker.observeRunningBuild({ ...build, queueId, requestOrder }, timing !== "cached");
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length - original,
        timing === "after notice" ? 1 : 0
      );
      tracker.dispose();
    }
  );

  it("keeps positive endpoint evidence from an old running response without invalidating an earlier result", async () => {
    const build = createBuild(42, "app");
    const { tracker, actions } = createHarness(() => ({ building: false, result: "SUCCESS" }));
    const requestOrder = nextBuildObservationOrder();
    let previous: FollowedBuildCompletion | undefined;
    tracker.onDidNotifyCompletion((notice) => {
      previous = notice;
    });
    tracker.recordPanelCompletion({ ...build, result: "SUCCESS", queueId: 18 });
    await tracker.followStartedBuild(build, "configured", undefined, previous);
    tracker.observeRunningBuild({ ...build, queueId: 17, requestOrder }, true);
    const open = tracker.showFollowedBuilds();
    picker.select(0);
    await Promise.resolve();
    picker.select(0);
    await open;
    assert.equal(actions.showBuildDetails.mock.calls.length, 0);
    assert.match(String(window.showWarningMessage.mock.calls.at(-1)?.[0]), /could not confirm/);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(window.showInformationMessage.mock.calls.length, 0);
    tracker.dispose();
  });

  it.each(
    ["picker", "completion"].flatMap((surface) =>
      ["fresh numbered", "cached numbered", "fresh permalink"].flatMap((observation) =>
        ["missing", "matching", "replacement"].map((id) => ({ surface, observation, id }))
      )
    )
  )(
    "checks a tree follow against its panel observation ($surface, $observation, $id)",
    async ({ surface, observation, id }) => {
      const build = createBuild(42, "app");
      let selecting = false;
      const { tracker, actions } = createHarness(() => ({
        building: surface === "picker",
        result: surface === "completion" ? "SUCCESS" : undefined,
        queueId: selecting && id !== "missing" ? (id === "matching" ? 17 : 18) : undefined
      }));
      tracker.follow(build);
      tracker.observeRunningBuild(
        {
          ...build,
          queueId: 17,
          observedUrl:
            observation === "fresh permalink"
              ? new URL("../lastBuild/", build.buildUrl).href
              : build.buildUrl
        },
        observation !== "cached numbered"
      );
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      const done = surface === "completion";
      let choose!: (action: string) => void;
      if (done)
        window.showInformationMessage.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              choose = resolve;
            })
        );
      await vi.advanceTimersByTimeAsync(10_000);
      selecting = true;
      if (done) {
        choose("View Build Details");
        await vi.advanceTimersByTimeAsync(0);
      } else {
        const open = tracker.showFollowedBuilds();
        picker.select(0);
        await Promise.resolve();
        picker.select(0);
        await open;
      }
      const allowed =
        observation === "cached numbered"
          ? !done || id === "missing"
          : id === "matching" || (id === "missing" && observation === "fresh permalink");
      assert.equal(actions.showBuildDetails.mock.calls.length, allowed ? 1 : 0);
      tracker.dispose();
    }
  );

  it.each(["panel follow", "queued terminal"])(
    "allows a numbered endpoint without queue metadata after the permalink identified its Run (%s)",
    async (source) => {
      const build = createBuild(42, "app");
      const panel = {
        ...build,
        queueId: 17,
        observedUrl: new URL("../lastBuild/", build.buildUrl).href
      };
      const { tracker, actions } = createHarness(() => ({ building: false, result: "SUCCESS" }));
      window.showInformationMessage.mockResolvedValueOnce("Preview Log");
      if (source === "panel follow") {
        tracker.followObservedBuild(panel);
        await vi.advanceTimersByTimeAsync(10_000);
      } else {
        tracker.followQueueItem({ environment: build.environment, label: "app", queueId: 17 });
        await tracker.claimPanelCompletion({
          notice: { ...panel, result: "SUCCESS", queueId: 17 }
        });
        await vi.advanceTimersByTimeAsync(0);
      }
      assert.equal(actions.previewLog.mock.calls.length, 1);
      assert.equal(actions.previewLog.mock.calls[0][0].buildUrl, build.buildUrl);
      tracker.dispose();
    }
  );

  it.each(["same", "running", "other queue", "other outcome", "transient error", "existing"])(
    "handles an overlapping result when the started notification is accepted (%s)",
    async (outcome) => {
      const build = createBuild(42, "app");
      const steps: DetailsResponse[] = [];
      if (outcome === "running") steps.push({ building: true, queueId: 17 });
      if (outcome === "transient error") steps.push(new Error("temporary"));
      steps.push({
        building: false,
        result: outcome === "other outcome" ? "FAILURE" : "SUCCESS",
        queueId: outcome === "other queue" ? 18 : 17
      });
      const { tracker } = createHarness(steps);
      if (outcome === "existing") tracker.follow(build);
      const previous = { result: "SUCCESS", queueId: 17 };
      await tracker.followStartedBuild(build, "configured", undefined, previous);
      await vi.advanceTimersByTimeAsync(40_000);
      assert.equal(tracker.count, 0);
      const notifications =
        window.showInformationMessage.mock.calls.length +
        window.showWarningMessage.mock.calls.length;
      assert.equal(notifications, ["same", "transient error"].includes(outcome) ? 0 : 1);
      tracker.dispose();
    }
  );

  it.each([
    "terminal Run",
    "running Run",
    "cause-located banner",
    "queue-located banner",
    "running panel",
    "panel follow",
    "terminal panel",
    "unrelated alias",
    "number only"
  ])(
    "rechecks the completed endpoint using its own queue identity evidence (%s)",
    async (source) => {
      const build = createBuild(42, "app");
      let phase: "running" | "finished" | "selection" = "running";
      let choose!: (action: string) => void;
      window.showInformationMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          })
      );
      const { tracker, getQueueItem, actions } = createHarness(() => ({
        building: phase === "running",
        result: phase === "running" ? undefined : "SUCCESS",
        queueId:
          (source === "terminal Run" && phase === "finished") ||
          (source === "running Run" && phase === "running")
            ? 17
            : undefined
      }));
      if (source.endsWith("banner"))
        await tracker.followStartedBuild(
          { ...build, queueId: 17 },
          "configured",
          source === "cause-located banner" ? 17 : undefined
        );
      else if (source === "panel follow") tracker.followObservedBuild({ ...build, queueId: 17 });
      else {
        getQueueItem.mockResolvedValue({ id: 17, executable: { number: 42, url: build.buildUrl } });
        tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      }
      await vi.advanceTimersByTimeAsync(10_000);
      if (source === "running panel" || source === "unrelated alias")
        tracker.observeRunningBuild(
          source === "running panel"
            ? { ...build, queueId: 17 }
            : { ...createBuild(42, "alias"), queueId: 17 },
          true
        );
      phase = "finished";
      if (source === "terminal panel")
        await tracker.claimPanelCompletion({
          notice: { ...build, result: "SUCCESS", queueId: 17 }
        });
      else await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(tracker.count, 0);
      phase = "selection";
      choose("Preview Log");
      await vi.advanceTimersByTimeAsync(0);
      const numberOnly = ["unrelated alias", "number only", "queue-located banner"].includes(
        source
      );
      assert.equal(actions.previewLog.mock.calls.length, numberOnly ? 1 : 0);
      if (numberOnly) assert.equal(actions.previewLog.mock.calls[0][0].buildUrl, build.buildUrl);
      else
        assert.match(String(window.showWarningMessage.mock.calls.at(-1)?.[0]), /could not confirm/);
      tracker.dispose();
    }
  );

  it("preserves Run identity evidence while a queued panel result waits for an outstanding executable", async () => {
    const first = createBuild(9, "first");
    const build = createBuild(9, "deferred");
    const { tracker, getQueueItem, actions } = createHarness(() => ({
      building: false,
      result: "SUCCESS"
    }));
    let release!: (item: JenkinsQueueItem) => void;
    getQueueItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "queued" });
    await vi.advanceTimersByTimeAsync(0);
    tracker.follow(first);
    void tracker.claimPanelCompletion({ notice: { ...first, result: "SUCCESS" } });
    void tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS", queueId: 17 } });
    assert.equal(window.showInformationMessage.mock.calls.length, 1);
    window.showInformationMessage.mockResolvedValueOnce("View Build Details");
    release({ id: 17 });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(window.showInformationMessage.mock.calls.length, 2);
    assert.equal(tracker.count, 0);
    assert.equal(actions.showBuildDetails.mock.calls.length, 0);
    assert.match(String(window.showWarningMessage.mock.calls.at(-1)?.[0]), /could not confirm/);
    tracker.dispose();
  });

  it("shows an error message when a notification action fails", async () => {
    const { tracker, actions } = createHarness(() => ({ building: false, result: "FAILURE" }));
    actions.previewLog.mockImplementation(() => {
      throw new Error("log unavailable");
    });
    window.showWarningMessage.mockResolvedValueOnce("Preview Log");

    tracker.follow(createBuild(7));
    await vi.advanceTimersByTimeAsync(10_000);

    assert.deepEqual(window.showErrorMessage.mock.calls, [
      ["Unable to preview build log: log unavailable"]
    ]);
  });

  it("backs off polling up to the maximum delay", async () => {
    const { tracker, getBuildDetails } = createHarness(() => ({ building: true }));
    tracker.follow(createBuild(1));

    // Polls at 10s, 25s (+15s), 47.5s (+22.5s), then every 30s.
    const checkpoints: Array<[number, number]> = [
      [9_999, 0],
      [1, 1],
      [15_000, 2],
      [22_500, 3],
      [29_999, 3],
      [1, 4],
      [30_000, 5]
    ];
    for (const [advanceMs, expectedCalls] of checkpoints) {
      await vi.advanceTimersByTimeAsync(advanceMs);
      assert.equal(getBuildDetails.mock.calls.length, expectedCalls);
    }
    tracker.dispose();
  });

  it("drops a build after the maximum consecutive errors and resets the count on success", async () => {
    const failure = new JenkinsRequestError("Jenkins unavailable", 503);
    const { tracker, getBuildDetails } = createHarness(
      [failure, failure, { building: true }, failure, failure, failure],
      { initialPollMs: 1_000, maxPollMs: 1_000, maxConsecutiveErrors: 3 }
    );
    tracker.follow(createBuild(3));

    await vi.advanceTimersByTimeAsync(5_000);
    assert.equal(tracker.count, 1);
    assert.equal(window.showWarningMessage.mock.calls.length, 0);

    await vi.advanceTimersByTimeAsync(1_000);
    assert.equal(getBuildDetails.mock.calls.length, 6);
    assert.equal(tracker.count, 0);
    assert.deepEqual(window.showWarningMessage.mock.calls, [
      ["Stopped following folder/job #3: Jenkins unavailable"]
    ]);

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(getBuildDetails.mock.calls.length, 6);
  });

  it.each(["missing status", "exhausted retries", "different build", "explicit stop"] as const)(
    "hands off a pending queue after the direct follow ends (%s)",
    async (cause) => {
      const build = createBuild(9, "app");
      const firstStatus =
        cause === "different build"
          ? { number: 8, building: true }
          : new JenkinsRequestError("Status unavailable", cause === "missing status" ? 404 : 503);
      const { tracker, getQueueItem, getBuildDetails } = createHarness(
        [
          ...(cause === "explicit stop" ? [] : [firstStatus]),
          { building: true, queueId: 17 },
          { building: false, result: "SUCCESS", queueId: 17 }
        ],
        { initialPollMs: 1000, maxPollMs: 1000, maxConsecutiveErrors: 1 }
      );
      let release!: (item: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(0);
      if (cause === "explicit stop") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(tracker.isFollowingBuild(build.environment, build.buildUrl), false);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), true);

      release({ id: 17, executable: { number: 9, url: build.buildUrl } });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(
        tracker.isFollowingBuild(build.environment, build.buildUrl),
        cause !== "explicit stop"
      );
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(tracker.count, 0);
      assert.deepEqual(
        window.showInformationMessage.mock.calls.map(([message]) => message),
        cause === "explicit stop" ? [] : ["app #9 finished: Success."]
      );
      assert.ok(getBuildDetails.mock.calls.every(([, url]) => url === build.buildUrl));
      tracker.dispose();
    }
  );

  it("drops a build that no longer exists", async () => {
    const { tracker, getBuildDetails, actions } = createHarness([
      new JenkinsActionError("Not found", "not_found", 404)
    ]);
    tracker.follow(createBuild(9));

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(tracker.count, 0);
    assert.deepEqual(window.showWarningMessage.mock.calls, [
      ["Stopped following folder/job #9: the build no longer exists."]
    ]);
    assert.equal(actions.refreshEnvironment.mock.calls.length, 0);

    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(getBuildDetails.mock.calls.length, 1);
  });

  it("renders the status bar item for zero, one, and two followed builds", () => {
    const { tracker } = createHarness(() => ({ building: true }));
    assert.equal(window.createStatusBarItem.mock.calls.length, 0);

    tracker.follow(createBuild(1));
    assert.deepEqual(window.createStatusBarItem.mock.calls[0], [1, 0]);
    assert.equal(statusBarItem.command, SHOW_FOLLOWED_BUILDS_COMMAND);
    assert.equal(statusBarItem.text, "$(eye) 1 following");
    assert.equal(statusBarItem.visible, true);

    tracker.follow(createBuild(2));
    assert.equal(statusBarItem.text, "$(eye) 2 following");
    assert.equal(
      statusBarItem.tooltip,
      "Following Jenkins builds:\n- folder/job #1\n- folder/job #2"
    );

    tracker.stopFollowingBuild(createBuild(1).environment, createBuild(1).buildUrl);
    assert.equal(statusBarItem.text, "$(eye) 1 following");
    assert.equal(statusBarItem.visible, true);

    tracker.stopFollowingBuild(createBuild(2).environment, createBuild(2).buildUrl);
    assert.equal(statusBarItem.visible, false);
    assert.equal(window.createStatusBarItem.mock.calls.length, 1);

    tracker.dispose();
    assert.equal(statusBarItem.dispose.mock.calls.length, 1);
  });

  it("stops polling a build after stopFollowing", async () => {
    const { tracker, getBuildDetails } = createHarness(() => ({ building: true }));
    tracker.follow(createBuild(1));
    tracker.stopFollowingBuild(createBuild(1).environment, createBuild(1).buildUrl);
    tracker.stopFollowingBuild(
      createBuild(1).environment,
      "https://jenkins.example/job/unknown/1/"
    );

    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(getBuildDetails.mock.calls.length, 0);
    assert.equal(tracker.count, 0);
    assert.equal(tracker.follow(createBuild(1)), "following");
    tracker.dispose();
  });

  it("shows an info message when no builds are followed", async () => {
    const { tracker } = createHarness(() => ({ building: true }));
    await tracker.showFollowedBuilds();
    assert.deepEqual(window.showInformationMessage.mock.calls, [
      ["No Jenkins builds are being followed."]
    ]);
    assert.equal(window.createQuickPick.mock.calls.length, 0);
  });

  it("opens build details or stops following from the followed builds picker", async () => {
    const { tracker, actions } = createHarness(() => ({ building: true }));
    const first = createBuild(1);
    const second = createBuild(2);
    tracker.follow(first);
    tracker.follow(second);

    const open = tracker.showFollowedBuilds();
    assert.deepEqual(
      picker.items.map(({ label, description }) => ({ label, description })),
      [
        { label: "folder/job #1", description: "Primary" },
        { label: "folder/job #2", description: "Primary" }
      ]
    );
    picker.select(0);
    await Promise.resolve();
    assert.equal(picker.items[0].label, "Open Build Details");
    picker.select(0);
    await open;
    assert.deepEqual(actions.showBuildDetails.mock.calls, [[first]]);
    assert.equal(tracker.count, 2);

    const stop = tracker.showFollowedBuilds();
    picker.select(1);
    await Promise.resolve();
    assert.equal(picker.items[1].label, "Stop following");
    picker.select(1);
    await stop;
    assert.equal(tracker.count, 1);
    assert.equal(statusBarItem.text, "$(eye) 1 following");

    const dismiss = tracker.showFollowedBuilds();
    picker.hide();
    await dismiss;
    assert.equal(window.createQuickPick.mock.calls.length, 5);
    assert.equal(tracker.count, 1);
    tracker.dispose();
  });

  it.each(["poll first", "picker first"])(
    "keeps a newer number-only picker terminal when an older poll reports running (%s)",
    async (order) => {
      const build = createBuild(42, "app");
      const { tracker, getBuildDetails, actions } = createHarness([
        { building: false, result: "SUCCESS" }
      ]);
      let earlier!: () => void;
      let later!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            earlier = () => resolve({ url: build.buildUrl, number: 42, building: true });
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            later = () =>
              resolve({ url: build.buildUrl, number: 42, building: false, result: "SUCCESS" });
          })
      );
      const receipts: FollowedBuildCompletion[] = [];
      tracker.onDidNotifyCompletion((notice) => {
        receipts.push(notice);
      });
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const open = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      picker.select(0);
      await vi.advanceTimersByTimeAsync(0);
      const [first, second] = order === "poll first" ? [earlier, later] : [later, earlier];
      first();
      await vi.advanceTimersByTimeAsync(0);
      second();
      await open;
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      assert.equal(actions.showBuildDetails.mock.calls.length, 1);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.ok(
        receipts[0]?.requestOrder &&
          receipts[0].noticeOrder &&
          receipts[0].requestOrder < receipts[0].noticeOrder
      );
      tracker.dispose();
    }
  );

  it.each(["poll first", "banner first"])(
    "honors an earlier exact terminal for a run a fresh banner just bound (%s)",
    async (order) => {
      const build = createBuild(42, "app");
      const { tracker, getBuildDetails } = createHarness([new JenkinsRequestError("Deleted", 404)]);
      let earlier!: () => void;
      let later!: () => void;
      const status = { url: build.buildUrl, number: 42, queueId: 17 };
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            earlier = () => resolve({ ...status, building: false, result: "SUCCESS" });
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            later = () => resolve({ ...status, building: true });
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const choice = tracker.followStartedBuild({ ...build, queueId: 17 });
      const [first, second] = order === "poll first" ? [earlier, later] : [later, earlier];
      first();
      await vi.advanceTimersByTimeAsync(0);
      second();
      await choice;
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it.each([undefined, 18])(
    "continues the verified run when an older terminal reports queue %s after binding",
    async (olderQueue) => {
      const build = createBuild(42, "app");
      const { tracker, getBuildDetails } = createHarness([
        { building: false, queueId: 17, result: "FAILURE" }
      ]);
      let old!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            old = () =>
              resolve({
                url: build.buildUrl,
                number: 42,
                building: false,
                queueId: olderQueue,
                result: "SUCCESS"
              });
          })
      );
      getBuildDetails.mockResolvedValueOnce({
        url: build.buildUrl,
        number: 42,
        building: true,
        queueId: 17
      });
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      await tracker.followStartedBuild({ ...build, queueId: 17 });
      old();
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), true);
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 0);
      assert.deepEqual(
        window.showWarningMessage.mock.calls.map(([message]) => message),
        ["app #42 finished: Failed."]
      );
      tracker.dispose();
    }
  );

  it.each(["conflict first", "picker first", "stop", "dispose"])(
    "retains an exact picker terminal through a competing replacement without opening the replacement (%s)",
    async (order) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails, actions } = createHarness([]);
      let conflicting!: () => void;
      let exact!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            conflicting = () =>
              resolve({ url: build.buildUrl, number: 42, queueId: 18, building: true });
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            exact = () =>
              resolve({
                url: build.buildUrl,
                number: 42,
                queueId: 17,
                building: false,
                result: "SUCCESS"
              });
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const open = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      picker.select(0);
      await vi.advanceTimersByTimeAsync(0);
      if (order === "picker first") {
        exact();
        await open;
        conflicting();
      } else {
        conflicting();
        await vi.advanceTimersByTimeAsync(0);
        if (order === "stop") tracker.stopFollowingQueueItem(build.environment, 17);
        if (order === "dispose") tracker.dispose();
        exact();
        await open;
      }
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(actions.showBuildDetails.mock.calls.length, order === "picker first" ? 1 : 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        ["stop", "dispose"].includes(order) ? 0 : 1
      );
      tracker.dispose();
    }
  );

  it.each(["queue first", "picker first", "stop old", "stop queued", "dispose"])(
    "retains the selected run's result during a separate queue handoff at its URL (%s)",
    async (order) => {
      const build = createBuild(42, "app");
      const { tracker, getBuildDetails, getQueueItem, actions } = createHarness([]);
      let finish!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({
                url: build.buildUrl,
                number: 42,
                queueId: 17,
                building: false,
                result: "SUCCESS"
              });
          })
      );
      let replace!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            replace = () =>
              resolve({ url: build.buildUrl, number: 42, queueId: 18, building: true });
          })
      );
      tracker.follow({ ...build, queueId: 17 });
      const open = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      picker.select(0);
      await vi.advanceTimersByTimeAsync(0);
      getQueueItem.mockResolvedValue({ id: 18, executable: { number: 42, url: build.buildUrl } });
      tracker.followQueueItem({ environment: build.environment, label: "app", queueId: 18 });
      await vi.advanceTimersByTimeAsync(0);
      if (order === "picker first") {
        finish();
        await open;
        replace();
      } else {
        replace();
        await vi.advanceTimersByTimeAsync(0);
        if (order === "stop old") tracker.stopFollowingQueueItem(build.environment, 17);
        if (order === "stop queued") tracker.stopFollowingQueueItem(build.environment, 18);
        if (order === "dispose") tracker.dispose();
        finish();
        await open;
      }
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        ["stop old", "dispose"].includes(order) ? 0 : 1
      );
      assert.equal(actions.showBuildDetails.mock.calls.length, order === "picker first" ? 1 : 0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      assert.equal(
        tracker.isFollowingQueueItem(build.environment, 18),
        !["stop queued", "dispose"].includes(order)
      );
      tracker.dispose();
    }
  );

  it.each(["another picker", "started notification"])(
    "uses the same replacement evidence from %s during a pending picker",
    async (source) => {
      const build = createBuild(42, "app");
      const { tracker, getBuildDetails, actions } = createHarness([]);
      let terminal!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            terminal = () =>
              resolve({
                url: build.buildUrl,
                number: 42,
                queueId: 17,
                building: false,
                result: "SUCCESS"
              });
          })
      );
      getBuildDetails.mockResolvedValueOnce({
        url: build.buildUrl,
        number: 42,
        queueId: 18,
        building: true
      });
      tracker.follow({ ...build, queueId: 17 });
      const select = async () => {
        const open = tracker.showFollowedBuilds();
        picker.select(0);
        await Promise.resolve();
        picker.select(0);
        return open;
      };
      const first = select();
      await vi.advanceTimersByTimeAsync(0);
      const competing =
        source === "another picker"
          ? select()
          : tracker.followStartedBuild({ ...build, queueId: 18 });
      await vi.advanceTimersByTimeAsync(0);
      terminal();
      await Promise.all([first, competing]);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), false);
      assert.equal(
        tracker.isFollowingQueueItem(build.environment, 18),
        source === "started notification"
      );
      tracker.dispose();
    }
  );

  it.each(["numbered", "terminal", "permalink", "other alias", "cached", "earlier request"])(
    "checks a selected numbered URL against a conflicting %s panel observation",
    async (route) => {
      const build = createBuild(42, "app");
      const alias = createBuild(42, "plugin");
      const { tracker, getBuildDetails, actions } = createHarness([]);
      const before = nextBuildObservationOrder();
      let finish!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({
                url: build.buildUrl,
                number: 42,
                queueId: 17,
                building: false,
                result: "SUCCESS"
              });
          })
      );
      tracker.follow({ ...build, queueId: 17 });
      tracker.observeRunningBuild({ ...alias, queueId: 17 });
      const open = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      picker.select(0);
      await vi.advanceTimersByTimeAsync(0);
      const observed = {
        ...(route === "other alias" ? alias : build),
        observedUrl:
          route === "permalink" ? new URL("../lastBuild/", build.buildUrl).href : undefined,
        queueId: 18,
        requestOrder: route === "earlier request" ? before : nextBuildObservationOrder()
      };
      if (route === "terminal") {
        tracker.observeBuildIdentity(observed);
        await tracker.claimPanelCompletion({ notice: { ...observed, result: "FAILURE" } });
      } else tracker.observeRunningBuild(observed, route !== "cached");
      finish();
      await open;
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(
        actions.showBuildDetails.mock.calls.length,
        ["numbered", "terminal"].includes(route) ? 0 : 1
      );
      assert.equal(tracker.count, 0);
      tracker.dispose();
    }
  );

  it.each(["primary", "permalink", "old request", "different controller"])(
    "holds the pending picker’s literal identity after its subscription has completed (%s)",
    async (route) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const oldRequest = nextBuildObservationOrder();
      const { tracker, getBuildDetails, actions } = createHarness([]);
      let reply!: (status: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reply = resolve;
          })
      );
      tracker.follow(build);
      const open = openFirstFollowedBuild(tracker);
      await vi.advanceTimersByTimeAsync(0);
      await tracker.claimPanelCompletion({ notice: { ...build, result: "SUCCESS" } });
      assert.equal(tracker.count, 0);
      tracker.observeBuildIdentity({
        ...build,
        environment:
          route === "different controller"
            ? { ...build.environment, scope: "workspace" }
            : build.environment,
        observedUrl:
          route === "permalink" ? new URL("../lastBuild/", build.buildUrl).href : undefined,
        queueId: 18,
        requestOrder: route === "old request" ? oldRequest : nextBuildObservationOrder()
      });
      reply({ number: 42, url: build.buildUrl, building: false, result: "SUCCESS", queueId: 17 });
      await open;
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.equal(actions.showBuildDetails.mock.calls.length, route === "primary" ? 0 : 1);
      tracker.dispose();
    }
  );

  it.each(["confirmed original", "confirmed replacement", "stop", "dispose"])(
    "requires positive identification after a numbered panel endpoint changes run (%s)",
    async (resolution) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails, actions } = createHarness([
        { building: false, result: "ABORTED" },
        { building: false, result: "FAILURE" },
        {
          building: false,
          result: "SUCCESS",
          queueId: resolution === "confirmed original" ? 17 : 18
        }
      ]);
      tracker.follow(build);
      const oldRequest = nextBuildObservationOrder();
      tracker.observeRunningBuild(
        { ...build, queueId: 18, requestOrder: nextBuildObservationOrder() },
        true
      );
      tracker.observeBuildIdentity({ ...build, requestOrder: oldRequest });
      tracker.observeBuildIdentity({
        ...build,
        observedUrl: new URL("../lastBuild/", build.buildUrl).href,
        requestOrder: nextBuildObservationOrder()
      });
      await openFirstFollowedBuild(tracker);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      assert.equal(tracker.count, 1);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      assert.ok(
        window.showWarningMessage.mock.calls.every(([text]) => !String(text).includes("finished:"))
      );
      if (resolution === "stop") tracker.stopFollowingQueueItem(build.environment, 17);
      if (resolution === "dispose") tracker.dispose();
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        resolution === "confirmed original" ? 1 : 0
      );
      assert.equal(tracker.count, 0);
      tracker.dispose();
    }
  );

  it.each(["exact", "number only", "stop", "dispose"])(
    "arbitrates a panel build number mismatch against an outstanding picker (%s)",
    async (outcome) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails, actions } = createHarness([]);
      let reply!: (status: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reply = resolve;
          })
      );
      tracker.follow(build);
      const open = openFirstFollowedBuild(tracker);
      await vi.advanceTimersByTimeAsync(0);
      tracker.rejectMismatchedBuild(
        build.environment,
        build.buildUrl,
        43,
        nextBuildObservationOrder()
      );
      if (outcome === "stop") tracker.stopFollowingQueueItem(build.environment, 17);
      if (outcome === "dispose") tracker.dispose();
      reply({
        number: 42,
        url: build.buildUrl,
        building: false,
        result: "SUCCESS",
        queueId: outcome === "number only" ? undefined : 17
      });
      await open;
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(window.showInformationMessage.mock.calls.length, outcome === "exact" ? 1 : 0);
      assert.equal(tracker.count, 0);
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      tracker.dispose();
    }
  );

  it.each(
    ["View Build Details", "Preview Log"].flatMap((action) =>
      ["missing", "corroborated", "stale terminal", "permalink"].map((evidence) => ({
        action,
        evidence
      }))
    )
  )(
    "guards $action from completion through its status check ($evidence)",
    async ({ action, evidence }) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails, actions } = createHarness([
        { building: false, result: "SUCCESS" }
      ]);
      let select!: (action: string) => void;
      window.showInformationMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            select = resolve;
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      let reply!: (status: JenkinsBuildDetails) => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reply = resolve;
          })
      );
      if (evidence === "stale terminal") {
        select(action);
        await vi.advanceTimersByTimeAsync(0);
      }
      tracker.observeBuildIdentity({
        ...build,
        queueId: 18,
        requestOrder: nextBuildObservationOrder(),
        observedUrl:
          evidence === "permalink" ? new URL("../lastBuild/", build.buildUrl).href : undefined
      });
      if (evidence !== "stale terminal") {
        select(action);
        await vi.advanceTimersByTimeAsync(0);
      }
      reply({
        number: 42,
        url: build.buildUrl,
        building: false,
        result: "SUCCESS",
        queueId: evidence === "corroborated" || evidence === "stale terminal" ? 17 : undefined
      });
      await vi.advanceTimersByTimeAsync(0);
      const permitted = evidence === "permalink" || evidence === "corroborated";
      assert.equal(
        actions.showBuildDetails.mock.calls.length,
        Number(permitted && action === "View Build Details")
      );
      assert.equal(
        actions.previewLog.mock.calls.length,
        Number(permitted && action === "Preview Log")
      );
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it.each(
    ["reused URL", "deleted URL"].flatMap((endpoint) =>
      ["poll first", "verification first", "stop", "dispose"].map((order) => ({ endpoint, order }))
    )
  )(
    "retains the independent panel verification’s exact result ($endpoint, $order)",
    async ({ endpoint, order }) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails } = createHarness([]);
      let poll!: () => void;
      let prove!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            poll = () =>
              endpoint === "reused URL"
                ? resolve({ number: 42, url: build.buildUrl, queueId: 18, building: true })
                : reject(new JenkinsRequestError("Removed", 404));
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            prove = () =>
              resolve({
                number: 42,
                url: build.buildUrl,
                queueId: 17,
                building: false,
                result: "SUCCESS"
              });
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const claim = tracker.claimPanelCompletion({
        notice: { ...build, queueId: undefined, result: "FAILURE" }
      });
      if (order === "verification first") {
        prove();
        await vi.advanceTimersByTimeAsync(0);
        poll();
      } else {
        poll();
        await vi.advanceTimersByTimeAsync(0);
        if (order === "stop") tracker.stopFollowingQueueItem(build.environment, 17);
        if (order === "dispose") tracker.dispose();
        prove();
      }
      assert.equal((await claim).disposition, order === "dispose" ? "handled" : "panel");
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.deepEqual(
        window.showInformationMessage.mock.calls,
        ["stop", "dispose"].includes(order)
          ? []
          : [["app #42 finished: Success.", "View Build Details", "Preview Log"]]
      );
      assert.equal(getBuildDetails.mock.calls.length, 2);
      tracker.dispose();
    }
  );

  it.each(["View Build Details", "Preview Log"])(
    "rejects an anonymous %s after the literal URL reported a second running and completed build",
    async (action) => {
      const build = createBuild(42, "app");
      const { tracker, actions } = createHarness([
        { building: false, result: "SUCCESS" },
        { building: true },
        { building: false, result: "SUCCESS" },
        { building: false, result: "SUCCESS" }
      ]);
      let choose!: (action: string) => void;
      window.showInformationMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 2);
      choose(action);
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(actions.previewLog.mock.calls.length, 0);
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      tracker.dispose();
    }
  );

  it.each(["fresh running", "stale running", "partial", "fresh permalink"])(
    "limits terminal-action invalidation to actual newer running observations at its literal URL (%s)",
    async (observation) => {
      const build = createBuild(42, "app");
      const { tracker, actions } = createHarness(() => ({ building: false, result: "SUCCESS" }));
      let choose!: (action: string) => void;
      window.showInformationMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          })
      );
      tracker.follow(build);
      const beforeResult = nextBuildObservationOrder();
      await vi.advanceTimersByTimeAsync(10_000);
      const observed = {
        ...build,
        requestOrder: observation === "stale running" ? beforeResult : nextBuildObservationOrder(),
        observedUrl:
          observation === "fresh permalink"
            ? new URL("../lastBuild/", build.buildUrl).href
            : undefined
      };
      if (observation === "partial") tracker.observeBuildIdentity(observed);
      else tracker.observeRunningBuild(observed, true);
      choose("Preview Log");
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(actions.previewLog.mock.calls.length, observation === "fresh running" ? 0 : 1);
      tracker.dispose();
    }
  );

  it.each(
    ["before notice", "after notice", "during action", "permalink"].flatMap((phase) =>
      ["missing", "matching", "different"].map((identity) => ({ phase, identity }))
    )
  )(
    "preserves partial positive endpoint evidence for completion actions ($phase, $identity)",
    async ({ phase, identity }) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, actions, getBuildDetails } = createHarness([
        { building: false, result: "SUCCESS" }
      ]);
      let choose!: (action: string) => void;
      window.showInformationMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          })
      );
      tracker.follow(build);
      const partial = () =>
        tracker.observeBuildIdentity({
          ...build,
          observedUrl:
            phase === "permalink" ? new URL("../lastBuild/", build.buildUrl).href : undefined,
          requestOrder: nextBuildObservationOrder()
        });
      if (phase === "before notice" || phase === "permalink") partial();
      await vi.advanceTimersByTimeAsync(10_000);
      if (phase === "after notice") partial();
      let reply!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reply = () =>
              resolve({
                number: 42,
                url: build.buildUrl,
                building: false,
                result: "SUCCESS",
                queueId: identity === "missing" ? undefined : identity === "matching" ? 17 : 18
              });
          })
      );
      choose("View Build Details");
      await vi.advanceTimersByTimeAsync(0);
      if (phase === "during action") partial();
      reply();
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(
        actions.showBuildDetails.mock.calls.length,
        Number(identity === "matching" || (identity === "missing" && phase === "permalink"))
      );
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it.each(["reconfirmed", "stopped", "disposed", "unconfirmed"])(
    "rechecks the current run after a conflicting poll waits for an action (%s)",
    async (outcome) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails, actions } = createHarness([
        { queueId: 17, building: false, result: "SUCCESS" }
      ]);
      let replacement!: () => void;
      let release!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            replacement = () =>
              resolve({ number: 42, url: build.buildUrl, queueId: 18, building: true });
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            release = () => reject(new Error("unavailable"));
          })
      );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const open = openFirstFollowedBuild(tracker);
      await vi.advanceTimersByTimeAsync(0);
      replacement();
      await vi.advanceTimersByTimeAsync(0);
      if (outcome !== "unconfirmed")
        tracker.observeBuildIdentity({ ...build, requestOrder: nextBuildObservationOrder() });
      if (outcome === "stopped") tracker.stopFollowingQueueItem(build.environment, 17);
      if (outcome === "disposed") tracker.dispose();
      release();
      await open;
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.isFollowingQueueItem(build.environment, 17), outcome === "reconfirmed");
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        outcome === "reconfirmed" ? 1 : 0
      );
      assert.equal(getBuildDetails.mock.calls.length, outcome === "reconfirmed" ? 3 : 2);
      tracker.dispose();
    }
  );

  it.each(["matching", "contradictory", "different number", "permalink", "fresh conflict"])(
    "retains exact endpoint capabilities from an older partial request without replacing newer status (%s)",
    async (observation) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const beforeFollow = nextBuildObservationOrder();
      const { tracker, actions } = createHarness(() => ({ building: false, result: "SUCCESS" }));
      let choose!: (value: string) => void;
      if (observation !== "fresh conflict")
        window.showInformationMessage.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              choose = resolve;
            })
        );
      tracker.follow(build);
      if (observation === "fresh conflict")
        tracker.observeBuildIdentity({
          ...build,
          queueId: 18,
          requestOrder: nextBuildObservationOrder()
        });
      tracker.observeBuildIdentity({
        ...build,
        queueId: observation === "contradictory" ? 18 : 17,
        buildNumber: observation === "different number" ? 43 : 42,
        observedUrl:
          observation === "permalink"
            ? new URL("../lastBuild/", build.buildUrl).href
            : build.buildUrl,
        requestOrder: beforeFollow
      });
      await vi.advanceTimersByTimeAsync(10_000);
      if (observation === "fresh conflict") {
        assert.equal(tracker.count, 1);
        assert.equal(window.showInformationMessage.mock.calls.length, 0);
      } else {
        assert.equal(tracker.count, 0);
        choose("View Build Details");
        await vi.advanceTimersByTimeAsync(0);
        assert.equal(
          actions.showBuildDetails.mock.calls.length,
          observation === "matching" ? 0 : 1
        );
      }
      tracker.dispose();
    }
  );

  it.each(["queue", "started notification"])(
    "rechecks a replacement from %s after the incumbent was reconfirmed during arbitration",
    async (source) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails, getQueueItem, actions } = createHarness([]);
      let release!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            release = () => reject(new Error("unavailable"));
          })
      );
      getBuildDetails.mockResolvedValueOnce({
        number: 42,
        url: build.buildUrl,
        queueId: 18,
        building: true
      });
      tracker.follow(build);
      const open = openFirstFollowedBuild(tracker);
      await vi.advanceTimersByTimeAsync(0);
      let started: ReturnType<Tracker["followStartedBuild"]> | undefined;
      if (source === "queue") {
        getQueueItem.mockResolvedValue({ id: 18, executable: { number: 42, url: build.buildUrl } });
        tracker.followQueueItem({ environment: build.environment, queueId: 18, label: "app" });
      } else started = tracker.followStartedBuild({ ...build, queueId: 18 });
      await vi.advanceTimersByTimeAsync(0);
      tracker.observeBuildIdentity({ ...build, requestOrder: nextBuildObservationOrder() });
      release();
      await open;
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(tracker.getObservedBuildState(build), "following");
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      if (started) assert.equal(await started, "unidentified");
      tracker.dispose();
    }
  );

  it("keeps matching literal Run metadata from a stopped picker for a subsequently followed run", async () => {
    const build = { ...createBuild(42, "app"), queueId: 17 };
    const { tracker, getBuildDetails, actions } = createHarness(() => ({
      building: false,
      result: "SUCCESS"
    }));
    let earlier!: () => void;
    getBuildDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          earlier = () => resolve({ number: 42, url: build.buildUrl, queueId: 17, building: true });
        })
    );
    tracker.follow(build);
    const open = openFirstFollowedBuild(tracker);
    await vi.advanceTimersByTimeAsync(0);
    tracker.stopFollowingQueueItem(build.environment, 17);
    tracker.follow(build);
    earlier();
    await open;
    assert.equal(tracker.isFollowingQueueItem(build.environment, 17), true);
    assert.equal(actions.showBuildDetails.mock.calls.length, 0);
    window.showInformationMessage.mockResolvedValueOnce("Preview Log");
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(tracker.count, 0);
    assert.equal(actions.previewLog.mock.calls.length, 0);
    assert.deepEqual(
      {
        calls: getBuildDetails.mock.calls.length,
        info: window.showInformationMessage.mock.calls,
        warn: window.showWarningMessage.mock.calls
      },
      {
        calls: 3,
        info: [["app #42 finished: Success.", "View Build Details", "Preview Log"]],
        warn: [
          ["Unable to open app #42: Jenkins could not confirm this result at its numbered URL."]
        ]
      }
    );
    tracker.dispose();
  });

  it.each(
    ["picker", "completion"].flatMap((surface) =>
      ["numbered", "permalink"].flatMap((route) =>
        [17, 18].map((returnedId) => ({ surface, route, returnedId }))
      )
    )
  )(
    "keeps the newest unbound panel identity for the $route route ($surface, ID $returnedId)",
    async ({ surface, route, returnedId }) => {
      const build = createBuild(42, "app");
      let checking = false;
      const { tracker, actions } = createHarness(() => ({
        building: !checking && surface === "picker",
        result: "SUCCESS",
        queueId: checking ? returnedId : undefined
      }));
      tracker.follow(build);
      const first = nextBuildObservationOrder();
      const second = nextBuildObservationOrder();
      const observedUrl =
        route === "permalink" ? new URL("../lastBuild/", build.buildUrl).href : build.buildUrl;
      tracker.observeRunningBuild(
        { ...build, observedUrl, queueId: 18, requestOrder: second },
        true
      );
      tracker.observeRunningBuild(
        { ...build, observedUrl, queueId: 17, requestOrder: first },
        true
      );
      if (surface === "picker") {
        checking = true;
        await openFirstFollowedBuild(tracker);
      } else {
        let select!: (action: string) => void;
        window.showInformationMessage.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              select = resolve;
            })
        );
        await vi.advanceTimersByTimeAsync(10_000);
        checking = true;
        select("View Build Details");
        await vi.advanceTimersByTimeAsync(0);
      }
      assert.equal(actions.showBuildDetails.mock.calls.length, Number(returnedId === 18));
      tracker.dispose();
    }
  );

  it.each([
    "older request",
    "still disputed",
    "cached",
    "permalink",
    "later literal",
    "later partial"
  ])("only reattaches a retired alias after its own subsequent Run observation (%s)", (source) => {
    const { tracker } = createHarness([]);
    const primary = { ...createBuild(42, "app"), queueId: 17 };
    const alias = { ...createBuild(42, "plugin"), queueId: 17 };
    tracker.follow(primary);
    tracker.observeRunningBuild(alias);
    const older = nextBuildObservationOrder();
    tracker.observeRunningBuild(
      { ...alias, queueId: 18, requestOrder: nextBuildObservationOrder() },
      true
    );
    assert.equal(tracker.isFollowingBuild(alias.environment, alias.buildUrl), false);
    const observed = {
      ...alias,
      requestOrder: source === "older request" ? older : nextBuildObservationOrder(),
      observedUrl:
        source === "permalink" ? new URL("../lastBuild/", alias.buildUrl).href : alias.buildUrl
    };
    if (source === "still disputed")
      tracker.observeBuildIdentity({
        ...alias,
        queueId: 18,
        requestOrder: nextBuildObservationOrder()
      });
    if (source === "later partial") tracker.observeBuildIdentity(observed);
    else tracker.observeRunningBuild(observed, source !== "cached");
    const restored = source === "later literal" || source === "later partial";
    if (restored) tracker.rejectMismatchedBuild(alias.environment, alias.buildUrl, 43, older);
    assert.equal(tracker.isFollowingBuild(alias.environment, alias.buildUrl), restored);
    assert.equal(tracker.isFollowingBuild(primary.environment, primary.buildUrl), true);
    tracker.stopFollowingObservedBuild(alias);
    assert.equal(tracker.count, restored ? 0 : 1);
    tracker.dispose();
  });

  it.each(
    ["poll first", "banner first"].flatMap((order) =>
      [true, false].flatMap((proven) =>
        [true, false].map((initiallyBound) => ({ order, proven, initiallyBound }))
      )
    )
  )(
    "retains a cause banner’s numbered queue-ID evidence through arbitration ($order, cause proof=$proven, initially bound=$initiallyBound)",
    async ({ order, proven, initiallyBound }) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, actions, getBuildDetails } = createHarness(() => ({
        building: false,
        result: "SUCCESS"
      }));
      let poll!: () => void;
      let verifying!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            poll = () =>
              resolve({
                number: 42,
                url: build.buildUrl,
                building: false,
                result: "SUCCESS"
              });
          })
      );
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            verifying = () =>
              resolve({
                number: 42,
                url: build.buildUrl,
                building: true
              });
          })
      );
      let select!: (value: string) => void;
      window.showInformationMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            select = resolve;
          })
      );
      tracker.follow(initiallyBound ? build : { ...build, queueId: undefined });
      await vi.advanceTimersByTimeAsync(10_000);
      const chosen = tracker.followStartedBuild(build, "configured", proven ? 17 : undefined);
      if (!initiallyBound) tracker.follow(build);
      (order === "poll first" ? poll : verifying)();
      await vi.advanceTimersByTimeAsync(0);
      (order === "poll first" ? verifying : poll)();
      await chosen;
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      select("Preview Log");
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(actions.previewLog.mock.calls.length, Number(!proven));
      tracker.dispose();
    }
  );

  it.each([
    "unidentified replacement",
    "followed original",
    "queued original",
    "original and replacement",
    "none",
    "different run"
  ])(
    "routes a superseded panel terminal only to the matching followed run (%s)",
    async (subscription) => {
      const build = createBuild(42, "app");
      const { tracker } = createHarness([{ queueId: 18, building: false, result: "FAILURE" }]);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      let release!: (value: JenkinsBuildDetails) => void;
      const earlier = readPanelBuildDetails(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const current = await readPanelBuildDetails(async () => ({
        number: 42,
        url: build.buildUrl,
        building: true
      }));
      state.updateDetails(current);
      coordinator.observeDetails(current);
      const replacement = [
        "unidentified replacement",
        "different run",
        "original and replacement"
      ].includes(subscription);
      if (
        subscription === "unidentified replacement" ||
        subscription === "original and replacement"
      )
        tracker.follow(build);
      if (subscription === "followed original") tracker.follow({ ...build, queueId: 17 });
      if (subscription === "queued original" || subscription === "original and replacement")
        tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      if (subscription === "different run") tracker.follow({ ...build, queueId: 18 });
      release({ number: 42, url: build.buildUrl, queueId: 17, building: false, result: "SUCCESS" });
      const stale = await earlier;
      const change = state.updateDetails(stale);
      assert.ok(change.superseded);
      coordinator.observeDetails(stale, change.superseded);
      await vi.advanceTimersByTimeAsync(0);
      const original = [
        "followed original",
        "queued original",
        "original and replacement"
      ].includes(subscription);
      assert.equal((await coordinator.reportCompletion(stale)).disposition, "handled");
      assert.equal(window.showInformationMessage.mock.calls.length, Number(original));
      assert.equal(present.mock.calls.length, 0);
      assert.equal(tracker.count, Number(replacement));
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(window.showWarningMessage.mock.calls.length, Number(replacement));
      assert.equal(tracker.count, 0);
      tracker.dispose();
    }
  );

  it.each(
    ["still running", "same result", "different result"].flatMap((status) =>
      [undefined, 18].map((queueId) => ({ status, queueId }))
    )
  )(
    "verifies an anonymous terminal requested before the follow's newer running observation ($status, $queueId)",
    async ({ status, queueId }) => {
      const build = createBuild(42, "app");
      const { tracker, getBuildDetails } = createHarness([
        { building: true },
        {
          building: status === "still running",
          queueId,
          result: status === "same result" ? "SUCCESS" : "FAILURE"
        },
        { building: false, result: "FAILURE", queueId }
      ]);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      tracker.onDidNotifyCompletion((notice) => {
        if (notice.source !== "panel") state.recordFollowedBuildCompletion(notice);
      });
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      tracker.follow(build);
      const older = await readPanelBuildDetails(async () => ({
        number: 42,
        url: build.buildUrl,
        building: false,
        result: "SUCCESS"
      }));
      await vi.advanceTimersByTimeAsync(10_000);
      state.updateDetails(older);
      const result = coordinator.reportCompletion(older);
      assert.equal(tracker.count, 1);
      await vi.advanceTimersByTimeAsync(0);
      await result;
      assert.equal(getBuildDetails.mock.calls.length, 2);
      assert.equal(tracker.count, Number(status === "still running"));
      assert.equal(present.mock.calls.length, Number(status !== "same result"));
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        Number(status === "same result")
      );
      assert.equal(window.showWarningMessage.mock.calls.length, Number(status !== "same result"));
      tracker.dispose();
    }
  );

  it.each(
    [
      "confirmation",
      "different ID",
      "different result",
      "anonymous",
      "partial",
      "intervening replacement"
    ].flatMap((next) => ["before claim", "during claim"].map((timing) => ({ next, timing })))
  )(
    "retains a delayed completion transition only with an uninterrupted positive terminal confirmation ($next, $timing)",
    async ({ next, timing }) => {
      const build = createBuild(42, "app");
      const { tracker } = createHarness([]);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      const raw = {
        number: 42,
        url: build.buildUrl,
        queueId: 17,
        building: false,
        result: "SUCCESS"
      };
      state.updateDetails(await readPanelBuildDetails(async () => ({ ...raw, building: true })));
      const first = await readPanelBuildDetails(async () => raw);
      assert.ok(state.updateDetails(first).completedNow);
      const replacement = await readPanelBuildDetails(async () => ({ ...raw, queueId: 18 }));
      const later = await readPanelBuildDetails(async () => ({
        ...raw,
        building: next === "partial" ? undefined : false,
        queueId: next === "different ID" ? 18 : next === "anonymous" ? undefined : 17,
        result: next === "different result" ? "FAILURE" : "SUCCESS"
      }));
      const claim = timing === "during claim" ? coordinator.reportCompletion(first) : undefined;
      if (next === "intervening replacement") state.updateDetails(replacement);
      assert.equal(state.updateDetails(later).completedNow, false);
      await (claim ?? coordinator.reportCompletion(first));
      assert.equal(present.mock.calls.length, Number(next === "confirmation"));
      tracker.dispose();
    }
  );

  it("rechecks the displayed response before presenting a delayed standalone completion", async () => {
    const build = createBuild(42, "app");
    const { tracker } = createHarness([]);
    const state = new BuildDetailsPanelState();
    state.resetForLoad(build.environment, build.buildUrl, "nonce");
    const present = vi.fn(async () => undefined);
    const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
    tracker.follow({ ...build, queueId: 18 });
    const terminal = await readPanelBuildDetails(async () => ({
      url: build.buildUrl,
      number: 42,
      queueId: 17,
      building: false,
      result: "SUCCESS"
    }));
    const replacement = await readPanelBuildDetails(async () => ({
      url: build.buildUrl,
      number: 42,
      building: true
    }));
    state.updateDetails(terminal);
    const claim = coordinator.reportCompletion(terminal);
    state.updateDetails(replacement);
    assert.equal((await claim).disposition, "handled");
    assert.equal(present.mock.calls.length, 0);
    assert.equal(tracker.isFollowingQueueItem(build.environment, 18), true);
    tracker.dispose();
  });

  it.each(
    ["failed", "unknown"].flatMap((verification) =>
      ["suppressed", "presented", "different result", "running after notice"].map((delivery) => ({
        verification,
        delivery
      }))
    )
  )(
    "requires actual panel presentation before suppressing a followed result ($verification, $delivery)",
    async ({ verification, delivery }) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails } = createHarness([
        ...(delivery === "running after notice" ? [{ building: true, queueId: 17 }] : []),
        {
          building: false,
          queueId: 17,
          result: delivery === "different result" ? "FAILURE" : "SUCCESS"
        }
      ]);
      let finish!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = () =>
              verification === "failed"
                ? reject(new Error("unavailable"))
                : resolve({ number: 42, url: build.buildUrl });
          })
      );
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      tracker.follow(build);
      const terminal = await readPanelBuildDetails(async () => ({
        number: 42,
        url: build.buildUrl,
        building: false,
        result: "SUCCESS"
      }));
      state.updateDetails(terminal);
      const checking = coordinator.reportCompletion(terminal);
      if (delivery === "suppressed")
        state.updateDetails(
          await readPanelBuildDetails(async () => ({
            number: 42,
            url: build.buildUrl,
            queueId: 17,
            building: true
          }))
        );
      finish();
      await checking;
      assert.equal(present.mock.calls.length, delivery === "suppressed" ? 0 : 1);
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        Number(delivery === "suppressed" || delivery === "running after notice")
      );
      assert.equal(
        window.showWarningMessage.mock.calls.length,
        Number(delivery === "different result")
      );
      tracker.dispose();
    }
  );

  it.each(["before verification settles", "after verification settles"])(
    "announces an explicit follow after the panel abandoned presentation (%s)",
    async (timing) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker } = createHarness([]);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      tracker.onDidNotifyCompletion((notice) => state.recordFollowedBuildCompletion(notice));
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      const raw = {
        number: 42,
        url: build.buildUrl,
        queueId: 17,
        building: false,
        result: "SUCCESS"
      };
      const old = await readPanelBuildDetails(async () => raw);
      const running = await readPanelBuildDetails(async () => ({ ...raw, building: true }));
      const terminal = await readPanelBuildDetails(async () => ({ ...raw }));
      state.updateDetails(old);
      const abandoned = coordinator.reportCompletion(old);
      state.updateDetails(running);
      if (timing === "after verification settles") await abandoned;
      tracker.follow(build);
      state.updateDetails(terminal);
      await Promise.all([abandoned, coordinator.reportCompletion(terminal)]);
      await coordinator.reportCompletion(terminal);
      assert.equal(tracker.count, 0);
      assert.equal(present.mock.calls.length, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it.each(["same load", "after navigation"])(
    "presents a concurrent standalone completion once (%s)",
    async (timing) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker } = createHarness([]);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "old");
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      const terminal = { number: 42, url: build.buildUrl, queueId: 17, building: false };
      state.updateDetails(terminal);
      const reports = [
        coordinator.reportCompletion(terminal),
        coordinator.reportCompletion(terminal)
      ];
      if (timing === "after navigation")
        state.resetForLoad(build.environment, createBuild(43, "app").buildUrl, "next");
      await Promise.all(reports);
      assert.equal(present.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it.each(["suppressed", "presented", "different result"])(
    "uses only committed panel results during queue handoff (%s)",
    async (delivery) => {
      const build = createBuild(42, "app");
      const { tracker, getQueueItem } = createHarness([
        {
          queueId: 17,
          building: false,
          result: delivery === "different result" ? "FAILURE" : "SUCCESS"
        }
      ]);
      let start!: () => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            start = () => resolve({ id: 17, executable: { number: 42, url: build.buildUrl } });
          })
      );
      tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      const present = vi.fn(async () => undefined);
      const coordinator = new BuildDetailsCompletionCoordinator(state, tracker, present);
      const terminal = await readPanelBuildDetails(async () => ({
        number: 42,
        url: build.buildUrl,
        building: false,
        result: "SUCCESS"
      }));
      const next = await readPanelBuildDetails(async () => ({
        number: 42,
        url: build.buildUrl,
        building: true
      }));
      state.updateDetails(terminal);
      const checking = coordinator.reportCompletion(terminal);
      if (delivery === "suppressed") state.updateDetails(next);
      await checking;
      start();
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(tracker.count, 0);
      assert.equal(present.mock.calls.length, delivery === "suppressed" ? 0 : 1);
      assert.equal(
        window.showInformationMessage.mock.calls.length,
        Number(delivery === "suppressed")
      );
      assert.equal(
        window.showWarningMessage.mock.calls.length,
        Number(delivery === "different result")
      );
      tracker.dispose();
    }
  );

  it.each(["SUCCESS", "FAILURE"])(
    "reconciles an inconclusive panel claim against a %s tracker notice delivered before presentation",
    async (result) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker } = createHarness([
        new Error("offline"),
        { queueId: 17, building: false, result }
      ]);
      const state = new BuildDetailsPanelState();
      state.resetForLoad(build.environment, build.buildUrl, "nonce");
      tracker.onDidNotifyCompletion((event) => state.recordFollowedBuildCompletion(event));
      const present = vi.fn(async () => undefined);
      let resume!: () => void;
      const ready = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const coordinator = new BuildDetailsCompletionCoordinator(
        state,
        {
          observeBuildIdentity: tracker.observeBuildIdentity.bind(tracker),
          observeRunningBuild: tracker.observeRunningBuild.bind(tracker),
          rejectMismatchedBuild: tracker.rejectMismatchedBuild.bind(tracker),
          recordPanelCompletion: tracker.recordPanelCompletion.bind(tracker),
          claimPanelCompletion: async (request) => {
            const decision = await tracker.claimPanelCompletion(request);
            await ready;
            return decision;
          }
        },
        present
      );
      tracker.follow(build);
      const terminal = await readPanelBuildDetails(async () => ({
        number: 42,
        url: build.buildUrl,
        building: false,
        result: "SUCCESS"
      }));
      state.updateDetails(terminal);
      const report = coordinator.reportCompletion(terminal);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      resume();
      await report;
      assert.equal(present.mock.calls.length, Number(result !== "SUCCESS"));
      tracker.dispose();
    }
  );

  it("opens and announces a build that finishes before its first scheduled poll", async () => {
    const build = createBuild(42, "app");
    const { tracker, getBuildDetails, actions } = createHarness([
      { building: false, result: "SUCCESS" },
      new JenkinsRequestError("Deleted", 404)
    ]);
    tracker.follow(build);
    const open = tracker.showFollowedBuilds();
    picker.select(0);
    await Promise.resolve();
    picker.select(0);
    await open;
    assert.deepEqual(actions.showBuildDetails.mock.calls, [
      [{ ...build, completion: { result: "SUCCESS" } }]
    ]);
    assert.equal(tracker.count, 0);
    await vi.advanceTimersByTimeAsync(30_000);
    assert.equal(getBuildDetails.mock.calls.length, 1);
    assert.equal(actions.refreshEnvironment.mock.calls.length, 1);
    assert.equal(window.showInformationMessage.mock.calls.length, 1);
    assert.equal(window.showWarningMessage.mock.calls.length, 0);
    tracker.dispose();
  });

  it.each(
    [17, undefined].flatMap((queueId) =>
      ["picker first", "404 first", "poll also completes"].map((order) => ({ queueId, order }))
    )
  )(
    "uses the picker's terminal response while a poll is in flight ($queueId, $order)",
    async ({ queueId, order }) => {
      const build = { ...createBuild(42, "app"), queueId };
      const done = { number: 42, url: build.buildUrl, queueId, building: false, result: "SUCCESS" };
      const { tracker, getBuildDetails, actions } = createHarness([]);
      let finishPoll!: () => void;
      let finishPicker!: () => void;
      getBuildDetails
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finishPoll = () =>
                order === "poll also completes"
                  ? resolve(done)
                  : reject(new JenkinsRequestError("Deleted", 404));
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishPicker = () => resolve(done);
            })
        );
      tracker.follow(build);
      await vi.advanceTimersByTimeAsync(10_000);
      const open = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      picker.select(0);
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      if (order === "picker first") {
        finishPicker();
        await open;
        finishPoll();
      } else {
        finishPoll();
        await vi.advanceTimersByTimeAsync(0);
        finishPicker();
        await open;
      }
      await vi.advanceTimersByTimeAsync(60_000);
      assert.deepEqual(
        actions.showBuildDetails.mock.calls.map(([run]) => run.buildUrl),
        [build.buildUrl]
      );
      assert.equal(tracker.count, 0);
      assert.equal(actions.refreshEnvironment.mock.calls.length, 1);
      assert.deepEqual(window.showInformationMessage.mock.calls, [
        ["app #42 finished: Success.", "View Build Details", "Preview Log"]
      ]);
      assert.equal(window.showWarningMessage.mock.calls.length, 0);
      assert.equal(getBuildDetails.mock.calls.length, 2);
      tracker.dispose();
    }
  );

  it.each(["stop", "dispose", "replace", "contradictory queue"])(
    "discards an obsolete terminal response from the picker (%s)",
    async (event) => {
      const build = { ...createBuild(42, "app"), queueId: 17 };
      const { tracker, getBuildDetails, actions } = createHarness([]);
      let release!: () => void;
      getBuildDetails.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                number: 42,
                url: build.buildUrl,
                queueId: event === "contradictory queue" ? 18 : 17,
                building: false,
                result: "FAILURE"
              });
          })
      );
      tracker.follow(build);
      const open = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      picker.select(0);
      await vi.advanceTimersByTimeAsync(0);
      if (event === "dispose") tracker.dispose();
      if (event === "stop" || event === "replace")
        tracker.stopFollowingQueueItem(build.environment, 17);
      if (event === "replace") tracker.follow({ ...build, queueId: 18 });
      release();
      await open;
      assert.equal(tracker.count, event === "replace" || event === "contradictory queue" ? 1 : 0);
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      assert.equal(actions.refreshEnvironment.mock.calls.length, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 0);
      assert.ok(
        window.showWarningMessage.mock.calls.every(
          ([message]) => !String(message).includes("finished")
        )
      );
      tracker.dispose();
    }
  );

  it("rechecks the controller when the user accepts Open Build Details", async () => {
    const { tracker, actions } = createHarness([]);
    tracker.follow(createBuild(3));
    const open = tracker.showFollowedBuilds();
    picker.select(0);
    await Promise.resolve();
    actions.isCurrentController.mockReturnValue(false);
    picker.select(0);
    await open;
    assert.equal(actions.showBuildDetails.mock.calls.length, 0);
    assert.equal(tracker.count, 0);
    tracker.dispose();
  });

  it.each([
    "matching",
    "number only",
    "changed ID",
    "missing ID",
    "wrong number",
    "stopped",
    "disposed",
    "controller changed"
  ])("verifies the handed-off run before opening it from the picker (%s)", async (outcome) => {
    const build = createBuild(42, "app");
    const { tracker, getQueueItem, getBuildDetails, actions } = createHarness(() => ({
      building: true,
      queueId: outcome === "number only" ? undefined : 17
    }));
    getQueueItem.mockResolvedValue({ id: 17, executable: { number: 42, url: build.buildUrl } });
    tracker.followQueueItem({ environment: build.environment, queueId: 17, label: "app" });
    const open = tracker.showFollowedBuilds();
    picker.select(0);
    await vi.advanceTimersByTimeAsync(2);
    let release!: (status: JenkinsBuildDetails) => void;
    getBuildDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    picker.select(0);
    await vi.advanceTimersByTimeAsync(0);
    if (outcome === "stopped") tracker.stopFollowingQueueItem(build.environment, 17);
    if (outcome === "disposed") tracker.dispose();
    if (outcome === "controller changed") actions.isCurrentController.mockReturnValue(false);
    release({
      url: build.buildUrl,
      number: outcome === "wrong number" ? 43 : 42,
      queueId:
        outcome === "changed ID"
          ? 18
          : ["missing ID", "number only"].includes(outcome)
            ? undefined
            : 17,
      building: true
    });
    await open;
    assert.equal(
      actions.showBuildDetails.mock.calls.length,
      ["matching", "number only"].includes(outcome) ? 1 : 0
    );
    tracker.dispose();
  });

  it("stops polling and ignores late results after dispose", async () => {
    let resolveDetails: ((value: Partial<JenkinsBuildDetails>) => void) | undefined;
    const getBuildDetails = vi.fn(
      () =>
        new Promise<Partial<JenkinsBuildDetails>>((resolve) => {
          resolveDetails = resolve;
        })
    );
    const actions = {
      isCurrentController: () => true,
      showBuildDetails: vi.fn(),
      previewLog: vi.fn(),
      refreshEnvironment: vi.fn()
    };
    const tracker = new BuildCompletionTracker(
      { getBuildDetails: getBuildDetails as never, getQueueItem: vi.fn() },
      actions
    );
    tracker.follow(createBuild(1));
    tracker.follow(createBuild(2));

    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(getBuildDetails.mock.calls.length, 2);

    tracker.dispose();
    assert.equal(tracker.count, 0);
    assert.equal(statusBarItem.dispose.mock.calls.length, 1);
    resolveDetails?.({ building: false, result: "SUCCESS" });
    await vi.advanceTimersByTimeAsync(60_000);

    assert.equal(getBuildDetails.mock.calls.length, 2);
    assert.equal(window.showInformationMessage.mock.calls.length, 0);
    assert.equal(actions.refreshEnvironment.mock.calls.length, 0);
    assert.equal(tracker.follow(createBuild(3)), "disposed");
    assert.equal(window.createStatusBarItem.mock.calls.length, 1);
  });
});

const environment = createBuild(1).environment;
function queueItem(queueId: number) {
  return { environment, queueId, taskUrl: "job/team/job/app/", label: "team/app" };
}

describe("queue and build subscriptions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    picker = createPicker();
  });
  afterEach(() => vi.useRealTimers());

  it("merges a direct follow acquired while the queue's alternate endpoint is being verified", async () => {
    const alternate = createBuild(13, "team/job/app");
    const advertised = new URL("plugin/runs/13/", alternate.environment.url).href;
    const { tracker, getBuildDetails, getQueueItem } = createHarness([]);
    getQueueItem.mockResolvedValue({ id: 17, executable: { number: 13, url: advertised } });
    let failAdvertised!: () => void;
    getBuildDetails.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failAdvertised = () => reject(new JenkinsRequestError("Missing advertised run", 404));
        })
    );
    const running = { number: 13, url: alternate.buildUrl, queueId: 17, building: true };
    getBuildDetails
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue({ ...running, building: false, result: "SUCCESS" });
    const notice = vi.fn();
    tracker.onDidNotifyCompletion(notice);
    tracker.followQueueItem({ environment: alternate.environment, queueId: 17, label: "app" });
    await vi.advanceTimersByTimeAsync(0);
    const submission = tracker.beginSubmittedQueueDiscovery(
      alternate.environment,
      17,
      new URL("../", alternate.buildUrl).href
    );
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(tracker.follow(alternate), "following");
    failAdvertised();
    await vi.advanceTimersByTimeAsync(0);

    assert.equal(tracker.count, 1);
    assert.ok(tracker.isFollowingQueueItem(alternate.environment, 17));
    assert.ok(tracker.isFollowingBuild(alternate.environment, alternate.buildUrl));
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      [advertised, alternate.buildUrl, alternate.buildUrl]
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith(
      expect.objectContaining({ buildUrl: alternate.buildUrl, queueId: 17, result: "SUCCESS" })
    );
    assert.equal(tracker.count, 0);
    submission.finish();
    tracker.dispose();
  });

  it.each(["completes", "stops during advertised read", "stops during alternate read"] as const)(
    "verifies the alternate task endpoint when the advertised executable returns 404 (%s)",
    async (outcome) => {
      const queue = queueItem(17);
      const alternate = new URL(`${queue.taskUrl}13/`, environment.url).href;
      const advertised = new URL("jenkins/job/team/job/app/13/", environment.url).href;
      const { tracker, getBuildDetails, getQueueItem } = createHarness([]);
      getQueueItem.mockResolvedValue({
        id: 17,
        task: { url: queue.taskUrl },
        executable: { number: 13, url: advertised }
      });
      let release!: () => void;
      const delayed = new Promise<void>((resolve) => {
        release = resolve;
      });
      getBuildDetails.mockImplementation(async (_env, url) => {
        if (url === advertised) {
          if (outcome === "stops during advertised read") await delayed;
          throw new JenkinsRequestError("Incorrect Jenkins prefix", 404);
        }
        if (outcome === "stops during alternate read") await delayed;
        return { number: 13, url, queueId: 17, building: false, result: "SUCCESS" };
      });
      const notice = vi.fn();
      tracker.onDidNotifyCompletion(notice);
      tracker.followQueueItem(queue);
      await vi.advanceTimersByTimeAsync(0);
      if (outcome !== "completes") tracker.stopFollowingQueueItem(environment, 17);
      release();
      await vi.advanceTimersByTimeAsync(10000);
      expect(getBuildDetails.mock.calls.map(([, url]) => url)).toEqual(
        outcome === "stops during advertised read" ? [advertised] : [advertised, alternate]
      );
      expect(tracker.count).toBe(0);
      expect(notice).toHaveBeenCalledTimes(outcome === "completes" ? 1 : 0);
      if (outcome === "completes")
        expect(notice).toHaveBeenCalledWith(
          expect.objectContaining({ buildUrl: alternate, queueId: 17, result: "SUCCESS" })
        );
      tracker.dispose();
    }
  );

  it.each(["build", "queue", "error"] as const)(
    "discards an in-flight %s response after a controller change before store notification",
    async (kind) => {
      const { tracker, getBuildDetails, getQueueItem, actions } = createHarness([]);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (kind === "build") {
        getBuildDetails.mockImplementationOnce(async () => {
          await pending;
          return { number: 3, url: createBuild(3).buildUrl, building: false, result: "SUCCESS" };
        });
        tracker.follow(createBuild(3));
      } else {
        getQueueItem.mockImplementationOnce(async () => {
          await pending;
          if (kind === "error") throw new JenkinsRequestError("Not found", 404);
          return { id: 3, executable: { number: 11 } };
        });
        tracker.followQueueItem(queueItem(3));
      }
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(getBuildDetails.mock.calls.length + getQueueItem.mock.calls.length, 1);
      actions.isCurrentController.mockReturnValue(false);
      release();
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length + getQueueItem.mock.calls.length, 1);
      assert.equal(actions.refreshEnvironment.mock.calls.length, 0);
      assert.equal(window.showWarningMessage.mock.calls.length, 0);
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      assert.match(String(window.showInformationMessage.mock.calls[0][0]), /environment changed/);
      tracker.dispose();
    }
  );

  it("keeps focus on the surviving run and distinguishes matching names in different folders", async () => {
    const { tracker, getQueueItem } = createHarness([{ building: true, queueId: 2 }]);
    const build = { ...createBuild(7, "service-b/job/main"), label: "main #7" };
    tracker.follow({ ...createBuild(7, "service-a/job/main"), label: "main #7" });
    tracker.followQueueItem({ ...queueItem(2), label: "main" });
    tracker.follow(build);
    getQueueItem.mockResolvedValue({ id: 2, executable: { number: 7, url: build.buildUrl } });
    const selection = tracker.showFollowedBuilds();
    picker.activeItems = [picker.items[1]];
    await vi.advanceTimersByTimeAsync(1);
    assert.deepEqual(
      picker.items.map((item) => item.label),
      ["service-a/main #7", "service-b/main #7"]
    );
    assert.equal(picker.activeItems[0], picker.items[1]);
    picker.hide();
    await selection;
    tracker.dispose();
  });

  it("stops old controller polls and aliases when an environment ID moves to another Jenkins", async () => {
    const { tracker, getQueueItem, getBuildDetails, actions } = createHarness([{ building: true }]);
    const queue = queueItem(21);
    const moved = {
      ...queue,
      environment: { ...queue.environment, url: "https://jenkins.example/new/" }
    };
    let release!: (item: JenkinsQueueItem) => void;
    getQueueItem.mockImplementation(async (_environment, id) =>
      id === 21
        ? { id, executable: { number: 10 } }
        : new Promise((resolve) => {
            release = resolve;
          })
    );
    tracker.followQueueItem(queue);
    tracker.followQueueItem(queueItem(22));
    await vi.advanceTimersByTimeAsync(100);
    assert.equal(tracker.count, 2);
    assert.equal(tracker.isFollowingQueueItem(moved.environment, 21), false);
    tracker.stopFollowingQueueItem(moved.environment, 21);
    assert.equal(tracker.isFollowingQueueItem(environment, 21), true);
    actions.isCurrentController.mockImplementation((ref) => ref.url === moved.environment.url);
    tracker.pruneChangedControllers();
    assert.equal(tracker.count, 0);
    assert.equal(tracker.isFollowingQueueItem(environment, 21), false);
    assert.equal(tracker.followQueueItem(moved), true);
    tracker.stopFollowingQueueItem(environment, 21);
    release({ id: 22, executable: { number: 11 } });
    await vi.advanceTimersByTimeAsync(100);
    assert.equal(tracker.count, 1);
    assert.equal(
      tracker.isFollowingBuild(moved.environment, `${moved.environment.url}job/team/job/app/10/`),
      true
    );
    assert.equal(getBuildDetails.mock.calls.length, 2);
    tracker.dispose();
  });

  it("tracks queue IDs independently when two builds of one job start out of order", async () => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([
      { building: false, result: "SUCCESS" },
      { building: false, result: "ABORTED" }
    ]);
    const second = { ...queueItem(22), label: "app" };
    const first = queueItem(21);
    let released = false;
    getQueueItem.mockImplementation(async (_env, id) => {
      if (id === first.queueId && !released) return { id };
      return { id, executable: { number: id === first.queueId ? 12 : 11 } };
    });
    tracker.followQueueItem(first);
    assert.equal(tracker.followQueueItem(first), false);
    tracker.followQueueItem(second);
    assert.equal(
      statusBarItem.tooltip,
      "Following Jenkins builds:\n- team/app (queue #21)\n- team/app (queue #22)"
    );
    await vi.advanceTimersByTimeAsync(100);
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      ["https://jenkins.example/job/team/job/app/11/"]
    );
    assert.equal(tracker.count, 1);
    assert.match(String(window.showInformationMessage.mock.calls[0][0]), /team\/app #11 finished/);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    assert.equal(tracker.isFollowingQueueItem(environment, first.queueId), true);
    released = true;
    await vi.advanceTimersByTimeAsync(31_000);
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      [
        "https://jenkins.example/job/team/job/app/11/",
        "https://jenkins.example/job/team/job/app/12/"
      ]
    );
    assert.equal(tracker.count, 0);
    assert.equal(
      window.showInformationMessage.mock.calls.length + window.showWarningMessage.mock.calls.length,
      2
    );
    tracker.dispose();
  });

  it("updates an open picker silently, merges an executable on the reachable environment and stops from the old queue ID", async () => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([
      { building: true, queueId: 2 }
    ]);
    const queue = queueItem(2);
    const build = { ...createBuild(9, "team/job/app"), label: "team/app #9" };
    getQueueItem.mockResolvedValue({
      id: 2,
      executable: { number: 9, url: "http://internal/controller/job/team/job/app/9/" }
    });
    tracker.followQueueItem(queue);
    const selection = tracker.showFollowedBuilds();
    tracker.follow(build);
    assert.equal(picker.items.length, 2);
    assert.equal(picker.items[0].label, "team/app (queue #2)");
    await vi.advanceTimersByTimeAsync(1);
    assert.deepEqual(
      picker.items.map((p) => p.label),
      ["team/app #9"]
    );
    assert.equal(tracker.isFollowingBuild(environment, build.buildUrl), true);
    assert.equal(tracker.isFollowingQueueItem(environment, 2), true);
    assert.equal(window.showInformationMessage.mock.calls.length, 0);
    tracker.stopFollowingQueueItem(environment, 2);
    await selection;
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(getBuildDetails.mock.calls.length, 1);
    assert.equal(tracker.isFollowingBuild(environment, build.buildUrl), false);
    assert.equal(tracker.isFollowingQueueItem(environment, 2), false);
    tracker.dispose();
  });

  it.each([false, true])(
    "updates the open queue action picker on handoff (merge: %s)",
    async (merge) => {
      const { tracker, getQueueItem, actions } = createHarness(() => ({
        building: true,
        queueId: 2
      }));
      const build = { ...createBuild(9, "team/job/app"), label: "team/app #9" };
      getQueueItem.mockResolvedValue({ id: 2, executable: { number: 9 } });
      tracker.followQueueItem(queueItem(2));
      if (merge) tracker.follow(build);

      const selection = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      const actionPicker = picker;
      assert.match(actionPicker.placeholder, /team\/app \(queue #2\)/);
      assert.deepEqual(
        actionPicker.items.map((item) => item.label),
        ["Stop following"]
      );
      actionPicker.activeItems = [actionPicker.items[0]];
      await vi.advanceTimersByTimeAsync(1);
      assert.match(actionPicker.placeholder, /team\/app #9$/);
      assert.deepEqual(
        actionPicker.items.map((item) => item.label),
        ["Open Build Details", "Stop following"]
      );
      assert.equal(actionPicker.activeItems[0].label, "Stop following");

      actionPicker.select(0);
      await selection;
      assert.deepEqual(actions.showBuildDetails.mock.calls, [
        [{ ...build, queueId: 2, requireQueueId: true }]
      ]);
      tracker.dispose();
    }
  );

  it.each(["stop", "finish", "dispose"])(
    "dismisses the open action picker on %s",
    async (reason) => {
      const { tracker, actions } = createHarness([{ building: false, result: "SUCCESS" }]);
      const build = createBuild(2);
      tracker.follow(build);
      const selection = tracker.showFollowedBuilds();
      picker.select(0);
      await Promise.resolve();
      const actionPicker = picker;

      if (reason === "stop") tracker.stopFollowingBuild(build.environment, build.buildUrl);
      if (reason === "finish") await vi.advanceTimersByTimeAsync(10_000);
      if (reason === "dispose") tracker.dispose();
      assert.equal(actionPicker.dispose.mock.calls.length, 1);
      actionPicker.select(0);
      await selection;
      assert.equal(actions.showBuildDetails.mock.calls.length, 0);
      tracker.dispose();
    }
  );

  it("uses the same queue item's previously reported task URL for a number-only executable", async () => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([{ building: true }]);
    getQueueItem
      .mockResolvedValueOnce({ id: 2, task: { url: "job/team/job/other/" } })
      .mockResolvedValueOnce({ id: 2, executable: { number: 3 } });
    tracker.followQueueItem({ ...queueItem(2), taskUrl: undefined });
    await vi.advanceTimersByTimeAsync(1);
    assert.match(String(statusBarItem.tooltip), /team\/other \(queue #2\)/);
    await vi.advanceTimersByTimeAsync(11_000);
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      ["https://jenkins.example/job/team/job/other/3/"]
    );
    tracker.dispose();
  });

  it("keeps view names out of the job identity on handoff", async () => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([{ building: true }]);
    getQueueItem.mockResolvedValue({
      id: 2,
      executable: { number: 7, url: "/view/job/job/team/view/job/job/app/7/" }
    });
    tracker.followQueueItem(queueItem(2));
    await vi.advanceTimersByTimeAsync(100);
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      ["https://jenkins.example/job/team/job/app/7/"]
    );
    tracker.dispose();
  });

  it("follows a URL-only executable from a relative path on the configured environment", async () => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([
      { building: false, result: "SUCCESS" }
    ]);
    const queue = {
      ...queueItem(3),
      environment: { ...environment, url: "https://jenkins.example/ci/" }
    };
    // Some Jenkins executables omit number. Their exact build URL is enough to identify the run.
    getQueueItem.mockResolvedValue({
      id: 3,
      executable: { url: "job/team/job/app/8/" }
    } as JenkinsQueueItem);
    tracker.followQueueItem(queue);
    await vi.advanceTimersByTimeAsync(100);
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      ["https://jenkins.example/ci/job/team/job/app/8/"]
    );
    assert.equal(tracker.count, 0);
    tracker.dispose();
  });

  it.each([
    ["/view/job/job/app/7/", "/job/app/7/"],
    [
      "/job/team/view/all/job/reactor/com.example%24library/7/",
      "/job/team/job/reactor/com.example%24library/7/"
    ],
    ["/job/team/view/job/job/matrix/os=linux,jdk=21/7/", "/job/team/job/matrix/os=linux,jdk=21/7/"]
  ])("merges a direct and queued follow of exact run %s", async (direct, canonical) => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([
      { building: true, queueId: 2 },
      { building: false, result: "SUCCESS", queueId: 2 }
    ]);
    const build = { ...createBuild(7), buildUrl: new URL(direct, environment.url).href };
    const queue = queueItem(2);
    getQueueItem.mockResolvedValue({
      id: 2,
      executable: { number: 7, url: `https://internal/proxy${canonical}` }
    });
    assert.equal(tracker.follow(build), "following");
    assert.equal(tracker.followQueueItem(queue), true);
    await vi.advanceTimersByTimeAsync(5);
    assert.equal(tracker.count, 1);
    assert.equal(tracker.isFollowingBuild(environment, build.buildUrl), true);
    assert.equal(tracker.isFollowingQueueItem(environment, 2), true);
    assert.equal(
      tracker.isFollowingBuild(environment, new URL(canonical, environment.url).href),
      true
    );
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(
      getBuildDetails.mock.calls.map(([, url]) => url),
      [new URL(canonical, environment.url).href, new URL(canonical, environment.url).href]
    );
    assert.equal(window.showInformationMessage.mock.calls.length, 1);
    tracker.dispose();
  });

  it.each([
    ["executable", "http://internal/job/team/job/app/"],
    ["task", "http://internal/job/team/job/app/"],
    ["executable", "/job/team/job/app/"],
    ["task", "/job/team/job/app/"]
  ])(
    "keeps the folder in %s URL %s when the public context is /job/",
    async (kind, internalJob) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness([
        { building: false, result: "SUCCESS", queueId: 2 }
      ]);
      const env = { ...environment, url: "https://public.example/job/" };
      const actualBuild = "https://public.example/job/job/team/job/app/7/";
      getQueueItem.mockResolvedValue({
        id: 2,
        task: { url: internalJob },
        executable: { number: 7, url: kind === "executable" ? `${internalJob}7/` : undefined }
      });
      assert.equal(
        tracker.follow({ ...createBuild(7), environment: env, buildUrl: `${internalJob}7/` }),
        "following"
      );
      tracker.followQueueItem({ ...queueItem(2), environment: env });
      await vi.advanceTimersByTimeAsync(10_000);
      assert.deepEqual(
        getBuildDetails.mock.calls.map(([, url]) => url),
        [actualBuild]
      );
      assert.equal(window.showInformationMessage.mock.calls.length, 1);
      tracker.dispose();
    }
  );

  it.each(["os=linux", "com.example$library"])(
    "ends a number-only follow when a proxy path could also identify project child %s",
    async (child) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
      const env = { ...environment, url: "https://public/job/" };
      const taskUrl = `http://internal/job/job/job/${child}/`;
      getQueueItem.mockResolvedValue({ id: 2, task: { url: taskUrl }, executable: { number: 7 } });
      tracker.followQueueItem({ ...queueItem(2), environment: env, taskUrl });
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length, 0);
      assert.match(String(window.showWarningMessage.mock.calls[0]?.[0]), /did not identify/);
      tracker.dispose();
    }
  );

  it.each([
    ["https://public.example/job/team/", "http://internal/job/team/job/app/"],
    ["https://public.example/job/team/", "/job/team/job/app/"],
    ["https://public.example/ci/", "https://public.example/view/job/job/os=linux/"]
  ])("declines ambiguous direct and queue subscriptions outside %s", async (url, job) => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
    const env = { ...environment, url };
    assert.equal(
      tracker.follow({ ...createBuild(7), environment: env, buildUrl: `${job}7/` }),
      "unidentified"
    );
    getQueueItem.mockImplementation(async (_env, id) => ({
      id,
      task: { url: job },
      executable: { number: 7, url: id === 2 ? `${job}7/` : undefined }
    }));
    for (const id of [2, 3]) tracker.followQueueItem({ ...queueItem(id), environment: env });
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(getBuildDetails.mock.calls.length, 0);
    assert.equal(window.showWarningMessage.mock.calls.length, 3);
    assert.match(
      String(window.showWarningMessage.mock.calls[0][0]),
      /did not identify the exact build/
    );
    tracker.dispose();
  });

  it("deduplicates equivalent build URLs only within the same environment scope and ID", () => {
    const { tracker } = createHarness([]);
    const build = createBuild(9, "team/job/app");
    assert.equal(tracker.follow(build), "following");
    assert.equal(
      tracker.follow({ ...build, buildUrl: "http://internal/context/view/dev/job/team/job/app/9" }),
      "already-following"
    );
    assert.equal(
      tracker.follow({ ...build, environment: { ...environment, scope: "workspace" } }),
      "following"
    );
    assert.equal(
      tracker.follow({ ...build, environment: { ...environment, environmentId: "other" } }),
      "following"
    );
    tracker.stopFollowingBuild(environment, build.buildUrl);
    assert.equal(tracker.count, 2);
    tracker.dispose();
  });

  it("deduplicates encoded matrix segments while polling the exact executable URL", async () => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([{ building: true }]);
    const url = new URL("job/matrix/os=%6Cinux/7/", environment.url).href;
    getQueueItem.mockResolvedValue({ id: 9, executable: { number: 7, url } });
    tracker.followQueueItem(queueItem(9));
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(getBuildDetails.mock.calls[0][1], url);
    const direct = { ...createBuild(7), buildUrl: url.replace("%6C", "l") };
    assert.equal(tracker.follow(direct), "already-following");
    assert.equal(tracker.count, 1);
    tracker.stopFollowingBuild(environment, direct.buildUrl);
    assert.equal(tracker.count, 0);
    tracker.dispose();
  });

  it.each(["os=linux", "com.example$library"])("qualifies a queued project child %s", (child) => {
    const { tracker } = createHarness([]);
    tracker.followQueueItem({
      ...queueItem(9),
      taskUrl: `job/team/job/project/${child}/`,
      label: child
    });
    assert.ok(String(statusBarItem.tooltip).includes(`team/project/${child} (queue #9)`));
    tracker.dispose();
  });

  it.each([408, 429])("retries a transient HTTP %i from a followed queue item", async (status) => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness([
      { building: false, result: "SUCCESS" }
    ]);
    getQueueItem
      .mockRejectedValueOnce(new JenkinsRequestError("Try again", status))
      .mockResolvedValue({ id: 9, executable: { number: 7 } });
    tracker.followQueueItem(queueItem(9));
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(tracker.count, 1);
    assert.equal(window.showWarningMessage.mock.calls.length, 0);
    await vi.advanceTimersByTimeAsync(11_000);
    assert.equal(getQueueItem.mock.calls.length, 2);
    assert.equal(getBuildDetails.mock.calls.length, 1);
    assert.equal(tracker.count, 0);
    tracker.dispose();
  });

  it.each(["stop", "dispose"] as const)(
    "ignores a queue result arriving after %s",
    async (action) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
      let release!: (item: JenkinsQueueItem) => void;
      getQueueItem.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const queue = queueItem(5);
      tracker.followQueueItem(queue);
      await vi.advanceTimersByTimeAsync(1);
      if (action === "stop") tracker.stopFollowingQueueItem(environment, 5);
      else tracker.dispose();
      release({ id: 5, executable: { number: 2 } });
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length, 0);
      assert.equal(
        window.showInformationMessage.mock.calls.length +
          window.showWarningMessage.mock.calls.length,
        0
      );
      tracker.dispose();
    }
  );

  it("ignores handoff after a directly followed build has already notified", async () => {
    const { tracker, getQueueItem, getBuildDetails } = createHarness(() => ({
      building: false,
      result: "SUCCESS"
    }));
    const build = createBuild(2, "team/job/app");
    getQueueItem
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValue({ id: 7, executable: { number: 2 } });
    tracker.follow(build);
    tracker.followQueueItem(queueItem(7));
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(getBuildDetails.mock.calls.length, 2);
    assert.equal(window.showInformationMessage.mock.calls.length, 1);
    assert.equal(tracker.count, 0);
    tracker.dispose();
  });

  it.each([
    {
      response: { id: 7, task: { url: "/job/matrix/os=linux/" }, executable: { number: 7 } },
      message: /did not identify/
    },
    { response: { id: 7, cancelled: true }, message: /cancelled in the queue/ },
    { response: new JenkinsRequestError("Not found", 404), message: /disappeared/ },
    { response: { id: 9, executable: { number: 1 } }, message: /did not identify/ },
    {
      response: { id: 7, task: { url: "job/team/job/app/44/" }, executable: { number: 1 } },
      message: /did not identify/
    },
    {
      response: { id: 7, executable: { number: 1, url: "job/team/job/app/11/" } },
      message: /did not identify/
    }
  ])(
    "clears the queue follow and explains the outcome for $response",
    async ({ response, message }) => {
      const { tracker, getQueueItem, getBuildDetails } = createHarness([]);
      if (response instanceof Error) getQueueItem.mockRejectedValue(response);
      else getQueueItem.mockResolvedValue(response);
      tracker.followQueueItem(queueItem(7));
      await vi.advanceTimersByTimeAsync(60_000);
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length, 0);
      const calls = [
        ...window.showInformationMessage.mock.calls,
        ...window.showWarningMessage.mock.calls
      ];
      assert.equal(calls.length, 1);
      assert.match(String(calls[0][0]), message);
      tracker.dispose();
    }
  );
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import type { FollowedBuild } from "../src/services/buildFollow/BuildFollowTypes";

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

const window = {
  createStatusBarItem: vi.fn(() => statusBarItem),
  showInformationMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => {
    return undefined;
  }),
  showWarningMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => {
    return undefined;
  }),
  showErrorMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => {
    return undefined;
  }),
  showQuickPick: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined)
};

vi.doMock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  window
}));

const { BuildCompletionTracker, SHOW_FOLLOWED_BUILDS_COMMAND } = await import(
  "../src/services/buildFollow/BuildCompletionTracker"
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
    return { number: 1, url: buildUrl, ...next } as JenkinsBuildDetails;
  });
  const actions = {
    showBuildDetails: vi.fn(async (_build: FollowedBuild) => undefined),
    previewLog: vi.fn(async (_build: FollowedBuild) => undefined),
    refreshEnvironment: vi.fn((_environmentId: string) => undefined)
  };
  const tracker: Tracker = new BuildCompletionTracker({ getBuildDetails }, actions, options);
  return { tracker, getBuildDetails, actions };
}

describe("BuildCompletionTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    statusBarItem.text = "";
    statusBarItem.tooltip = undefined;
    statusBarItem.command = undefined;
    statusBarItem.visible = false;
    window.showInformationMessage.mockImplementation(async () => undefined);
    window.showWarningMessage.mockImplementation(async () => undefined);
    window.showQuickPick.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("de-duplicates follows by build URL and runs one poll chain", async () => {
    const { tracker, getBuildDetails } = createHarness(() => ({ building: true }));
    const build = createBuild(42);

    assert.equal(tracker.follow(build), true);
    assert.equal(tracker.follow({ ...build }), false);
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

  it("dispatches the notification actions", async () => {
    const { tracker, actions } = createHarness(() => ({ building: false, result: "SUCCESS" }));
    window.showInformationMessage
      .mockResolvedValueOnce("View Build Details")
      .mockResolvedValueOnce("Preview Log");
    const first = createBuild(1);
    const second = createBuild(2);

    tracker.follow(first);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(actions.showBuildDetails.mock.calls, [[first]]);
    assert.equal(actions.previewLog.mock.calls.length, 0);

    tracker.follow(second);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.deepEqual(actions.previewLog.mock.calls, [[second]]);
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

    tracker.stopFollowing(createBuild(1).buildUrl);
    assert.equal(statusBarItem.text, "$(eye) 1 following");
    assert.equal(statusBarItem.visible, true);

    tracker.stopFollowing(createBuild(2).buildUrl);
    assert.equal(statusBarItem.visible, false);
    assert.equal(window.createStatusBarItem.mock.calls.length, 1);

    tracker.dispose();
    assert.equal(statusBarItem.dispose.mock.calls.length, 1);
  });

  it("stops polling a build after stopFollowing", async () => {
    const { tracker, getBuildDetails } = createHarness(() => ({ building: true }));
    tracker.follow(createBuild(1));
    tracker.stopFollowing(createBuild(1).buildUrl);
    tracker.stopFollowing("https://jenkins.example/job/unknown/1/");

    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(getBuildDetails.mock.calls.length, 0);
    assert.equal(tracker.count, 0);
    assert.equal(tracker.follow(createBuild(1)), true);
    tracker.dispose();
  });

  it("shows an info message when no builds are followed", async () => {
    const { tracker } = createHarness(() => ({ building: true }));
    await tracker.showFollowedBuilds();
    assert.deepEqual(window.showInformationMessage.mock.calls, [
      ["No Jenkins builds are being followed."]
    ]);
    assert.equal(window.showQuickPick.mock.calls.length, 0);
  });

  it("opens build details or stops following from the followed builds picker", async () => {
    const { tracker, actions } = createHarness(() => ({ building: true }));
    const first = createBuild(1);
    const second = createBuild(2);
    tracker.follow(first);
    tracker.follow(second);

    window.showQuickPick.mockImplementationOnce(async (items: unknown) => {
      const picks = items as Array<{ label: string; description: string; build: FollowedBuild }>;
      assert.deepEqual(
        picks.map(({ label, description }) => ({ label, description })),
        [
          { label: "folder/job #1", description: "Primary" },
          { label: "folder/job #2", description: "Primary" }
        ]
      );
      return picks[0];
    });
    window.showQuickPick.mockResolvedValueOnce("Open Build Details");
    await tracker.showFollowedBuilds();
    assert.deepEqual(actions.showBuildDetails.mock.calls, [[first]]);
    assert.equal(tracker.count, 2);

    window.showQuickPick.mockImplementationOnce(async (items: unknown) => {
      return (items as unknown[])[1];
    });
    window.showQuickPick.mockResolvedValueOnce("Stop following");
    await tracker.showFollowedBuilds();
    assert.equal(tracker.count, 1);
    assert.equal(statusBarItem.text, "$(eye) 1 following");

    window.showQuickPick.mockResolvedValueOnce(undefined);
    await tracker.showFollowedBuilds();
    assert.equal(window.showQuickPick.mock.calls.length, 5);
    assert.equal(tracker.count, 1);
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
      showBuildDetails: vi.fn(),
      previewLog: vi.fn(),
      refreshEnvironment: vi.fn()
    };
    const tracker = new BuildCompletionTracker(
      { getBuildDetails: getBuildDetails as never },
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
    assert.equal(tracker.follow(createBuild(3)), false);
    assert.equal(window.createStatusBarItem.mock.calls.length, 1);
  });
});

import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { ArtifactActionRequest } from "../src/ui/ArtifactActionHandler";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import {
  BuildDetailsPanelState,
  getPanelBuildRequestOrder
} from "../src/panels/buildDetails/BuildDetailsPanelState";
import type { BuildDetailsPanelControllerAccess } from "../src/panels/buildDetails/BuildDetailsPanelControllerTypes";
import type { BuildDetailsOutgoingMessage } from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";
import { nextBuildObservationOrder } from "../src/services/buildFollow/BuildFollowObservationOrder";
import * as vscodeStub from "./helpers/vscodeStub";

const warningPrompts: Array<{ message: string; options: unknown; items: string[] }> = [];
const errorMessages: string[] = [];
const infoMessages: string[] = [];
const openedUrls: string[] = [];
let warningResponse: string | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  StatusBarAlignment: { Left: 1 },
  env: {
    openExternal: async (uri: vscodeStub.Uri) => {
      openedUrls.push(`${uri.scheme}://${uri.authority}${uri.path}`);
      return true;
    }
  },
  window: {
    createStatusBarItem: () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }),
    showWarningMessage: async (message: string, options: unknown, ...items: string[]) => {
      warningPrompts.push({ message, options, items });
      return warningResponse;
    },
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showQuickPick: async () => undefined
  }
}));

const { BuildDetailsPanelActions } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelActions"
);

const { BuildDetailsCompletionCoordinator } = await import(
  "../src/panels/buildDetails/BuildDetailsCompletionCoordinator"
);

const { BuildCompletionTracker } = await import(
  "../src/services/buildFollow/BuildCompletionTracker"
);

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "env-1",
  url: "https://jenkins.example/"
};

type ManagementResult = "changed" | "unchanged" | "cancelled" | "deleted" | "failed";

function createActions(options?: {
  environment?: JenkinsEnvironmentRef;
  tracker?: InstanceType<typeof BuildCompletionTracker>;
  rejectError?: Error;
  details?: Partial<JenkinsBuildDetails> & { number: number };
  workflowResult?: ManagementResult;
  workflowError?: Error;
  withoutWorkflow?: boolean;
  withoutArtifactHandler?: boolean;
  withoutBuildUrl?: boolean;
  buildUrl?: string;
  buildFollowUp?: unknown;
  onRestart?: (buildUrl: string) => void;
}) {
  const artifactRequests: ArtifactActionRequest[] = [];
  const posted: BuildDetailsOutgoingMessage[] = [];
  const statusRefreshes: number[] = [];
  const fullEnvironmentRefresh = vi.fn(() => ({ executed: true }));
  const workflowCalls: Array<{ method: string; target: unknown; keep?: boolean }> = [];
  const workflowMethod = (method: string) => async (target: unknown, keep?: boolean) => {
    workflowCalls.push(keep === undefined ? { method, target } : { method, target, keep });
    if (options?.workflowError) {
      throw options.workflowError;
    }
    return options?.workflowResult ?? "unchanged";
  };
  const workflow = {
    setKeepForever: workflowMethod("setKeepForever"),
    editBuild: workflowMethod("editBuild"),
    deleteBuild: workflowMethod("deleteBuild")
  };
  const details =
    options && "details" in options
      ? options.details
      : { number: 9, fullDisplayName: "app #9", building: false, result: "FAILURE" };
  const buildUrl = options?.buildUrl ?? "https://jenkins.example/job/app/9/";
  const state = new BuildDetailsPanelState();
  if (!options?.withoutBuildUrl)
    state.resetForLoad(options?.environment ?? environment, buildUrl, "nonce");
  if (details) state.updateDetails(details as JenkinsBuildDetails);
  const restarts: string[] = [];
  const rejects: string[] = [];
  const controller = {
    getBackend: () => ({
      pendingInputs: {
        getPendingInputActions: async () => [{ id: "deploy", message: "Deploy?", parameters: [] }],
        approveInput: async () => undefined,
        rejectInput: async (_env: unknown, _url: string, inputId: string) => {
          if (options?.rejectError) {
            throw options.rejectError;
          }
          rejects.push(inputId);
        }
      },
      restart: {
        restartPipelineFromStage: async (_env: unknown, url: string, stage: string) => {
          restarts.push(stage);
          options?.onRestart?.(url);
        }
      }
    }),
    getEnvironment: () => options?.environment ?? environment,
    getBuildUrl: () => state.currentBuildUrl,
    getCurrentDetails: () => state.currentDetails,
    getRunningFollowTarget: () => state.getRunningFollowTarget(),
    getFollowTargetToken: () => state.followTargetToken,
    getLoadToken: () => 1,
    getPipelineRestartAvailability: () => "supported",
    getPipelineRestartEnabled: () => true,
    getPipelineRestartableStages: () => ["Deploy"],
    refreshPendingInputs: async () => undefined,
    refreshBuildStatus: async (token: number) => {
      statusRefreshes.push(token);
    },
    beginLoading: () => 1,
    endLoading: () => undefined,
    postMessage: (message: BuildDetailsOutgoingMessage) => {
      posted.push(message);
    }
  } as unknown as BuildDetailsPanelControllerAccess;

  const completionTracker = {
    observeRunningBuild: vi.fn(),
    observeBuildIdentity: vi.fn(),
    rejectMismatchedBuild: vi.fn(),
    claimPanelCompletion: vi.fn(),
    recordPanelCompletion: vi.fn(),
    isFollowingQueueItem: vi.fn(() => false),
    followObservedBuild: vi.fn(() => "following" as const),
    getObservedBuildState: vi.fn((): "available" | "following" | "conflict" => "available"),
    stopFollowingObservedBuild: vi.fn()
  };
  const actions = new BuildDetailsPanelActions({
    completionTracker: options?.tracker ?? completionTracker,
    controller,
    getArtifactActionHandler: () =>
      options?.withoutArtifactHandler
        ? undefined
        : {
            handle: async (request: ArtifactActionRequest) => {
              artifactRequests.push(request);
            }
          },
    getConsoleExporter: () => {
      throw new Error("unused");
    },
    getRefreshHost: () => ({ fullEnvironmentRefresh }),
    getTestSourceNavigationUiService: () => undefined,
    getBuildManagementWorkflow: () => (options?.withoutWorkflow ? undefined : (workflow as never)),
    getBuildFollowUp: () => options?.buildFollowUp as never
  });
  const coordinator = new BuildDetailsCompletionCoordinator(
    state,
    options?.tracker ?? completionTracker,
    async () => {}
  );
  return {
    publishRead(details: JenkinsBuildDetails) {
      coordinator.observeDetails(details);
      actions.postBuildFollowState("details");
    },
    actions,
    state,
    completionTracker,
    posted,
    restarts,
    rejects,
    statusRefreshes,
    fullEnvironmentRefresh,
    workflowCalls,
    artifactRequests
  };
}

describe("Build Details completion follow", () => {
  it.each([
    ["numbered URL", false, "SUCCESS", "FAILURE", true],
    ["numbered URL", false, "SUCCESS", "SUCCESS", false],
    ["alias", false, "SUCCESS", "FAILURE", true],
    ["alias", true, "SUCCESS", "FAILURE", true],
    ["queue ID", true, "SUCCESS", "FAILURE", true],
    ["queue ID", true, "SUCCESS", "SUCCESS", false],
    ["alias", false, undefined, "FAILURE", false],
    ["alias", false, "SUCCESS", undefined, false]
  ] as const)(
    "checks the identified %s notice (cached ID %s, prior %s, terminal %s) before deduplicating an anonymous response",
    async (source, cachedId, priorResult, result, independent) => {
      const url = `${environment.url}job/app/9/`;
      const alias = `${environment.url}plugin/runs/9/`;
      const running = { number: 9, url, building: true };
      const { state } = createActions({
        details: cachedId ? { ...running, queueId: 17 } : running
      });
      const event = { environment, buildUrl: url, buildNumber: 9, label: "app #9" };
      state.recordFollowedBuildCompletion({ ...event, queueId: 16, result: "ABORTED" });
      state.updateDetails(await state.readBuildDetails(async () => running));
      state.recordFollowedBuildCompletion({
        ...event,
        queueId: 17,
        result: priorResult,
        buildUrl: source === "numbered URL" ? url : alias,
        aliases: source === "alias" ? [url] : undefined
      });
      const terminal = { ...running, building: false, result };
      assert.equal(state.hasCompletionNotice(terminal), !independent);
      assert.equal(state.hasCompletionNotice({ ...terminal, queueId: 17 }), true);
    }
  );

  it("retains a corroborated provisional result across later queue-ID-only aliases", () => {
    const url = `${environment.url}job/app/9/`;
    const running = { number: 9, url, building: true };
    const { state } = createActions({ details: running });
    const event = { environment, buildUrl: url, buildNumber: 9, label: "app #9" };
    state.recordFollowedBuildCompletion({ ...event, result: "SUCCESS" });
    const terminal = { ...running, building: false, result: "SUCCESS" };
    assert.equal(state.hasCompletionNotice({ ...terminal, queueId: 17 }), true);
    state.recordFollowedBuildCompletion({ ...event, queueId: 17 });
    assert.equal(state.hasCompletionNotice({ ...terminal, result: "FAILURE" }), false);
  });

  it("keeps the displayed status order separate from the queue ID's original observation", async () => {
    const url = `${environment.url}job/app/9/`;
    const running = { url, number: 9, building: true };
    const { publishRead, actions, state, completionTracker } = createActions({ details: running });
    completionTracker.isFollowingQueueItem.mockReturnValue(true);
    const first = await state.readBuildDetails(async () => ({ ...running, queueId: 18 }));
    state.updateDetails(first);
    publishRead(first);
    const older = await state.readBuildDetails(async () => ({ ...running, queueId: 17 }));
    const partial = await state.readBuildDetails(async () => ({ number: 9, url }));
    state.updateDetails(partial);
    assert.equal(state.currentDetails?.building, true);
    assert.equal(state.currentDetails?.queueId, 18);
    assert.ok(state.currentDetails);
    const partialOrder = getPanelBuildRequestOrder(partial);
    assert.ok(partialOrder);
    assert.equal(getPanelBuildRequestOrder(state.currentDetails), partialOrder);
    assert.ok(state.updateDetails(older).superseded);
    actions.postBuildFollowState();
    const [cached, fresh] = completionTracker.observeRunningBuild.mock.lastCall ?? [];
    assert.equal(fresh, false);
    assert.equal(cached.queueId, 18);
    assert.equal(cached.requestOrder, getPanelBuildRequestOrder(first));
    assert.ok(cached.requestOrder < partialOrder);
  });

  it.each(["before", "after"] as const)(
    "uses the start of a number-only status read to distinguish a new run from a provisional result (%s the notice)",
    async (timing) => {
      const url = `${environment.url}job/app/9/`;
      const running = { url, number: 9, building: true };
      const finished = { ...running, building: false, result: "FAILURE" };
      const { actions, state, posted, completionTracker } = createActions({ details: running });
      let release!: (details: JenkinsBuildDetails) => void;
      const read = () =>
        state.readBuildDetails(
          () =>
            new Promise((resolve) => {
              release = resolve;
            })
        );
      let pending = timing === "before" ? read() : undefined;
      assert.equal(state.hasCompletionNotice(finished), false);
      state.recordFollowedBuildCompletion({
        environment,
        buildUrl: url,
        buildNumber: 9,
        label: "app #9",
        result: "FAILURE"
      });
      pending ??= read();
      release(running);
      state.updateDetails(await pending);
      actions.postBuildFollowState();
      const fresh = timing === "after";
      assert.deepEqual(posted.at(-1), {
        type: "buildFollowingChanged",
        followTargetToken: state.followTargetToken,
        following: false,
        buildNumber: fresh ? 9 : null,
        loadToken: 1
      });
      actions.handleSetBuildFollowing({
        type: "setBuildFollowing",
        followTargetToken: state.followTargetToken,
        following: true,
        buildNumber: 9,
        loadToken: 1
      });
      assert.equal(completionTracker.followObservedBuild.mock.calls.length, fresh ? 1 : 0);
      assert.equal(state.hasCompletionNotice(finished), !fresh);
    }
  );

  it("retains the original notice order when a late alias identifies an older completion", async () => {
    const url = `${environment.url}job/app/9/`;
    const running = { url, number: 9, building: true };
    const { state } = createActions({ details: running });
    const oldOrder = nextBuildObservationOrder();
    state.updateDetails(await state.readBuildDetails(async () => running));
    state.recordFollowedBuildCompletion({
      environment,
      buildUrl: `${environment.url}plugin/runs/9/`,
      aliases: [url],
      buildNumber: 9,
      queueId: 17,
      label: "app #9",
      result: "FAILURE",
      noticeOrder: oldOrder
    });
    assert.ok(state.getRunningFollowTarget());
    const replacement = { ...running, building: false, result: "FAILURE" };
    assert.equal(state.hasCompletionNotice(replacement), false);
    assert.equal(state.hasCompletionNotice({ ...replacement, queueId: 17 }), true);
  });

  it.each(["identified", "unidentified"] as const)(
    "drops the cached queue ID after a fresh number-only read supersedes an %s completion",
    async (identity) => {
      const url = `${environment.url}job/app/9/`;
      const running = { url, number: 9, building: true };
      const { state } = createActions({ details: { ...running, queueId: 17 } });
      state.recordFollowedBuildCompletion({
        environment,
        buildUrl: url,
        buildNumber: 9,
        label: "app #9",
        result: "FAILURE",
        queueId: identity === "identified" ? 17 : undefined
      });
      state.updateDetails(await state.readBuildDetails(async () => running));
      const next = state.getRunningFollowTarget();
      assert.ok(next);
      assert.equal(next.queueId, undefined);
      const terminal = { ...running, building: false, result: "FAILURE" };
      assert.equal(state.hasCompletionNotice(terminal), false);
      if (identity === "identified") {
        assert.equal(state.hasCompletionNotice({ ...terminal, queueId: 17 }), true);
      }
    }
  );

  it("keeps the request endpoint on fresh and cached observations until the panel navigates", () => {
    const job = `${environment.url}job/app/`;
    const numbered = `${job}42/`;
    const permalink = `${job}lastBuild/`;
    const details = { number: 42, url: numbered, queueId: 17, building: true };
    const { publishRead, actions, completionTracker, state } = createActions({
      buildUrl: permalink,
      details
    });
    completionTracker.isFollowingQueueItem.mockReturnValue(true);
    const pinned = {
      environment,
      buildUrl: numbered,
      observedUrl: permalink,
      buildNumber: 42,
      queueId: 17,
      label: "app #42"
    };
    publishRead(details);
    state.updateDetails({ ...details, queueId: undefined });
    actions.postBuildFollowState();
    actions.handleSetBuildFollowing({
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      buildNumber: 42,
      queueId: 17,
      loadToken: 1,
      following: true
    });
    assert.deepEqual(completionTracker.observeRunningBuild.mock.calls, [
      [pinned, true],
      [pinned, false]
    ]);
    assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [[pinned]]);

    state.resetForLoad(environment, numbered, "next");
    state.updateDetails(details);
    publishRead(details);
    assert.deepEqual(completionTracker.observeRunningBuild.mock.lastCall, [
      { ...pinned, observedUrl: numbered },
      true
    ]);
  });

  it("hides the follow action when a running observation confirms an already announced alias", () => {
    const { publishRead, state, completionTracker, posted } = createActions({
      details: { number: 9, building: true, queueId: 17 }
    });
    completionTracker.observeRunningBuild.mockImplementation((target) =>
      state.recordFollowedBuildCompletion(target)
    );
    publishRead({
      number: 9,
      url: `${environment.url}job/app/9/`,
      queueId: 17,
      building: true
    });
    assert.deepEqual(posted.at(-1), {
      type: "buildFollowingChanged",
      followTargetToken: state.followTargetToken,
      following: false,
      buildNumber: null,
      loadToken: 1
    });
  });

  it.each(["direct", "partial", "partial with queue ID", "terminal without queue ID"])(
    "follows the replacement after a displayed terminal run at the same number (%s)",
    async (intermediate) => {
      vi.useFakeTimers();
      const messagesBefore = infoMessages.length;
      const buildUrl = `${environment.url}job/app/9/`;
      const run = { url: buildUrl, number: 9 };
      const replacement = { ...run, building: true, queueId: 18 };
      const getBuildDetails = vi
        .fn()
        .mockResolvedValueOnce(replacement)
        .mockResolvedValue({ ...replacement, building: false, result: "SUCCESS" });
      const tracker = new BuildCompletionTracker(
        { getBuildDetails, getQueueItem: vi.fn() },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      try {
        const { publishRead, state, actions, posted } = createActions({
          tracker,
          buildUrl,
          details: undefined
        });
        const initial = await state.readBuildDetails(async () => ({
          ...run,
          queueId: 17,
          building: intermediate === "terminal without queue ID"
        }));
        state.applyInitialState({ details: initial, errors: [] }, undefined, undefined);
        if (intermediate === "terminal without queue ID")
          state.updateDetails(
            await state.readBuildDetails(async () => ({ ...run, building: false }))
          );
        if (intermediate.startsWith("partial"))
          state.updateDetails(
            await state.readBuildDetails(async () => ({
              ...run,
              queueId: intermediate === "partial with queue ID" ? 17 : undefined
            }))
          );
        assert.equal(state.currentDetails?.building, false);
        const current = await state.readBuildDetails(async () => ({ ...run, building: true }));
        state.updateDetails(current);
        publishRead(current);
        const header = posted.at(-1);
        assert.ok(header?.type === "buildFollowingChanged" && header.buildNumber === 9);
        assert.equal(header.queueId, undefined);
        actions.handleSetBuildFollowing({
          ...header,
          buildNumber: 9,
          type: "setBuildFollowing",
          following: true
        });
        assert.equal(tracker.count, 1);
        assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
        await vi.advanceTimersToNextTimerAsync();
        assert.equal(tracker.isFollowingQueueItem(environment, 18), true);
        const notified = vi.fn();
        tracker.onDidNotifyCompletion(notified);
        await vi.advanceTimersByTimeAsync(60_000);
        assert.equal(tracker.count, 0);
        assert.equal(infoMessages.length, messagesBefore + 1);
        assert.deepEqual(
          notified.mock.calls.map(([notice]) => [notice.queueId, notice.result]),
          [[18, "SUCCESS"]]
        );
      } finally {
        tracker.dispose();
        vi.useRealTimers();
      }
    }
  );

  it("retains a continuously running queue identity across a superseded terminal response", async () => {
    const run = { url: `${environment.url}job/app/9/`, number: 9 };
    const { state } = createActions({ details: undefined });
    const initial = await state.readBuildDetails(async () => ({
      ...run,
      building: true,
      queueId: 17
    }));
    state.updateDetails(initial);
    const obsolete = await state.readBuildDetails(async () => ({
      ...run,
      building: false,
      queueId: 17
    }));
    const newer = await state.readBuildDetails(async () => ({ ...run, building: true }));
    state.updateDetails(newer);
    assert.equal(state.updateDetails(obsolete).superseded, true);
    state.updateDetails(await state.readBuildDetails(async () => ({ ...run })));
    state.updateDetails(await state.readBuildDetails(async () => ({ ...run, building: true })));
    assert.equal(state.getRunningFollowTarget()?.queueId, 17);
    assert.equal(state.getRunningFollowTarget()?.requestOrder, getPanelBuildRequestOrder(initial));
  });

  it("keeps a replacement queue handoff followed while stale panel clicks arrive", async () => {
    vi.useFakeTimers();
    const buildUrl = `${environment.url}job/app/9/`;
    const run = (queueId?: number) => ({ url: buildUrl, number: 9, building: true, queueId });
    const getBuildDetails = vi.fn(async () => run(18));
    const tracker = new BuildCompletionTracker(
      {
        getQueueItem: async () => ({ id: 18, executable: { number: 9, url: buildUrl } }),
        getBuildDetails
      },
      {
        isCurrentController: () => true,
        refreshEnvironment: vi.fn(),
        showBuildDetails: vi.fn(),
        previewLog: vi.fn()
      }
    );
    try {
      const { publishRead, actions, posted, state } = createActions({
        tracker,
        details: run(17),
        buildUrl
      });
      tracker.onDidChange(() => actions.postBuildFollowState());
      publishRead(run(17));
      const header = posted.at(-1);
      assert.ok(header?.type === "buildFollowingChanged" && header.buildNumber !== null);
      const oldClick = {
        ...header,
        buildNumber: header.buildNumber,
        type: "setBuildFollowing" as const
      };
      assert.equal(oldClick.queueId, 17);
      tracker.followQueueItem({ environment, queueId: 18, label: "app" });
      await vi.advanceTimersByTimeAsync(0);
      assert.ok(tracker.isFollowingBuild(environment, buildUrl));
      assert.deepEqual(posted.at(-1), {
        type: "buildFollowingChanged",
        followTargetToken: state.followTargetToken,
        buildNumber: null,
        following: false,
        loadToken: 1
      });
      for (const following of [false, true])
        actions.handleSetBuildFollowing({ ...oldClick, following });
      assert.ok(tracker.isFollowingQueueItem(environment, 18));
      assert.equal(tracker.count, 1);

      state.updateDetails(run(18));
      publishRead(run(18));
      const next = posted.at(-1);
      assert.ok(
        next?.type === "buildFollowingChanged" && next.buildNumber !== null && next.following
      );
      assert.equal(next.queueId, 18);
      actions.handleSetBuildFollowing({ ...oldClick, following: false });
      assert.ok(tracker.isFollowingQueueItem(environment, 18));
      actions.handleSetBuildFollowing({
        ...next,
        type: "setBuildFollowing",
        following: false,
        buildNumber: next.buildNumber
      });
      actions.handleSetBuildFollowing({ ...oldClick, following: true });
      assert.equal(tracker.count, 0);
      assert.equal(getBuildDetails.mock.calls.length, 0);
    } finally {
      tracker.dispose();
      vi.useRealTimers();
    }
  });

  it("rejects a header click made before the panel learned the queue ID", () => {
    const details = { number: 9, building: true, url: `${environment.url}job/app/9/` };
    const { actions, completionTracker, state } = createActions({ details });
    actions.postBuildFollowState();
    const click = {
      type: "setBuildFollowing" as const,
      followTargetToken: state.followTargetToken,
      following: true,
      buildNumber: 9,
      loadToken: 1
    };
    state.updateDetails({ ...details, queueId: 17 });
    actions.handleSetBuildFollowing(click);
    actions.handleSetBuildFollowing({ ...click, following: false });
    assert.equal(completionTracker.followObservedBuild.mock.calls.length, 0);
    assert.equal(completionTracker.stopFollowingObservedBuild.mock.calls.length, 0);
    state.updateDetails(details);
    actions.postBuildFollowState();
    actions.handleSetBuildFollowing({
      ...click,
      queueId: 17,
      followTargetToken: state.followTargetToken
    });
    assert.equal(completionTracker.followObservedBuild.mock.calls.length, 1);
  });

  it("waits for fresh evidence before associating a new direct follow with the cached panel queue", async () => {
    vi.useFakeTimers();
    const buildUrl = `${environment.url}job/app/9/`;
    const tracker = new BuildCompletionTracker(
      {
        getQueueItem: vi.fn(),
        getBuildDetails: async () => ({ number: 9, url: buildUrl, queueId: 18, building: true })
      },
      {
        isCurrentController: () => true,
        refreshEnvironment: vi.fn(),
        showBuildDetails: vi.fn(),
        previewLog: vi.fn()
      }
    );
    try {
      const { publishRead, actions, posted, state } = createActions({
        tracker,
        buildUrl,
        details: { number: 9, building: true, queueId: 17 }
      });
      tracker.onDidChange(() => actions.postBuildFollowState());
      actions.postBuildFollowState();
      const click = {
        type: "setBuildFollowing" as const,
        followTargetToken: state.followTargetToken,
        buildNumber: 9,
        queueId: 17,
        loadToken: 1
      };
      actions.handleSetBuildFollowing({ ...click, following: true });
      actions.handleSetBuildFollowing({ ...click, following: false });
      tracker.follow({ environment, buildUrl, buildNumber: 9, label: "app #9" });
      assert.deepEqual(posted.at(-1), {
        type: "buildFollowingChanged",
        followTargetToken: state.followTargetToken,
        buildNumber: null,
        following: false,
        loadToken: 1
      });
      actions.handleSetBuildFollowing({ ...click, following: false });
      assert.equal(tracker.count, 1);
      actions.handleSetBuildFollowing({ ...click, following: true });
      // A panel read started before the tree follow may also finish during this interval.
      publishRead({ number: 9, url: buildUrl, queueId: 17, building: true });
      assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
      await vi.advanceTimersToNextTimerAsync();
      assert.equal(tracker.isFollowingQueueItem(environment, 18), true);
      assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
      assert.equal(tracker.count, 1);
    } finally {
      tracker.dispose();
      vi.useRealTimers();
    }
  });

  it.each(["queue first", "panel first", "after handoff", "direct follow"])(
    "links a reported run to the original queue and alternate URLs before polling (%s)",
    async (timing) => {
      vi.useFakeTimers();
      const executableUrl = `${environment.url}plugin/runs/9/`;
      const buildUrl = `${environment.url}matrix/custom/9/`;
      const details = { number: 9, queueId: 17, building: true };
      const queue = { environment, queueId: 17, label: "app" };
      const getQueueItem = vi.fn(async () => ({
        id: 17,
        executable: { number: 9, url: executableUrl }
      }));
      const getBuildDetails = vi.fn(async () => ({ ...details, url: executableUrl }));
      const tracker = new BuildCompletionTracker(
        { getQueueItem, getBuildDetails },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      try {
        const { actions, posted, state } = createActions({ tracker, buildUrl, details });
        if (timing === "panel first") {
          actions.postBuildFollowState();
          assert.deepEqual(posted.at(-1), {
            type: "buildFollowingChanged",
            followTargetToken: state.followTargetToken,
            following: false,
            buildNumber: 9,
            queueId: 17,
            loadToken: 1
          });
        }
        if (timing === "after handoff") {
          tracker.followQueueItem(queue);
          await vi.advanceTimersByTimeAsync(0);
          assert.ok(tracker.isFollowingBuild(environment, executableUrl));
        }
        if (timing === "direct follow") {
          const first = createActions({ tracker, buildUrl: executableUrl, details });
          first.actions.postBuildFollowState();
          first.actions.handleSetBuildFollowing({
            type: "setBuildFollowing",
            followTargetToken: first.state.followTargetToken,
            following: true,
            buildNumber: 9,
            queueId: 17,
            loadToken: 1
          });
        }
        if (timing === "queue first") tracker.followQueueItem(queue);
        tracker.onDidChange(() => actions.postBuildFollowState());
        if (timing === "panel first") tracker.followQueueItem(queue);
        else actions.postBuildFollowState();
        assert.deepEqual(posted.at(-1), {
          type: "buildFollowingChanged",
          followTargetToken: state.followTargetToken,
          following: true,
          buildNumber: 9,
          queueId: 17,
          loadToken: 1
        });
        assert.ok(tracker.isFollowingBuild(environment, buildUrl));
        assert.ok(tracker.isFollowingQueueItem(environment, 17));
        assert.equal(tracker.count, 1);
        assert.equal(getBuildDetails.mock.calls.length, 0);
        actions.handleSetBuildFollowing({
          type: "setBuildFollowing",
          followTargetToken: state.followTargetToken,
          following: true,
          buildNumber: 9,
          queueId: 17,
          loadToken: 1
        });
        assert.equal(tracker.count, 1);
        actions.handleSetBuildFollowing({
          type: "setBuildFollowing",
          followTargetToken: state.followTargetToken,
          following: false,
          buildNumber: 9,
          queueId: 17,
          loadToken: 1
        });
        assert.equal(tracker.count, 0);
        assert.equal(tracker.isFollowingBuild(environment, executableUrl), false);
        assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
      } finally {
        tracker.dispose();
        vi.useRealTimers();
      }
    }
  );
  it.each(["while displayed", "during load"])(
    "hides the follow control and rejects stale clicks when the tracker finishes %s",
    (timing) => {
      const jobUrl = "https://jenkins.example/job/app/";
      const details = { number: 10, url: `${jobUrl}10/`, building: true };
      const { actions, completionTracker, posted, state } = createActions({
        buildUrl: `${jobUrl}lastBuild/`,
        details: timing === "during load" ? undefined : details
      });
      state.recordFollowedBuildCompletion({
        environment,
        buildUrl: details.url,
        buildNumber: 10,
        label: "app #10"
      });
      if (timing === "during load") state.updateDetails(details);
      actions.postBuildFollowState();
      const click = {
        type: "setBuildFollowing",
        followTargetToken: state.followTargetToken,
        following: true,
        loadToken: 1,
        buildNumber: 10
      } as const;
      actions.handleSetBuildFollowing(click);
      actions.handleSetBuildFollowing({ ...click, following: false });
      assert.deepEqual(posted.at(-1), {
        type: "buildFollowingChanged",
        followTargetToken: state.followTargetToken,
        loadToken: 1,
        buildNumber: null,
        following: false
      });
      assert.equal(completionTracker.followObservedBuild.mock.calls.length, 0);
      assert.equal(completionTracker.stopFollowingObservedBuild.mock.calls.length, 0);

      state.updateDetails({ ...details, number: 11, url: `${jobUrl}11/` });
      actions.postBuildFollowState();
      actions.handleSetBuildFollowing({
        ...click,
        buildNumber: 11,
        followTargetToken: state.followTargetToken
      });
      assert.deepEqual(posted.at(-1), {
        type: "buildFollowingChanged",
        followTargetToken: state.followTargetToken,
        loadToken: 1,
        buildNumber: 11,
        following: false
      });
      assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [
        [
          {
            environment,
            buildUrl: `${jobUrl}11/`,
            observedUrl: `${jobUrl}lastBuild/`,
            buildNumber: 11,
            label: "app #11"
          }
        ]
      ]);
    }
  );

  it("applies the displayed action only to the currently loaded running build", () => {
    const { actions, completionTracker, posted, statusRefreshes, state } = createActions({
      details: { number: 9, fullDisplayName: "app #9", building: true }
    });
    actions.postBuildFollowState();
    const message = {
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      following: true,
      loadToken: 1,
      buildNumber: 9
    } as const;
    actions.handleSetBuildFollowing({ ...message, loadToken: 2 });
    actions.handleSetBuildFollowing(message);
    actions.handleSetBuildFollowing({ ...message, following: false, loadToken: 2 });
    actions.handleSetBuildFollowing({ ...message, following: false });
    const buildUrl = "https://jenkins.example/job/app/9/";
    assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [
      [
        {
          environment,
          buildUrl,
          observedUrl: buildUrl,
          buildNumber: 9,
          label: "app #9"
        }
      ]
    ]);
    assert.deepEqual(completionTracker.stopFollowingObservedBuild.mock.calls, [
      [{ environment, buildUrl, observedUrl: buildUrl, buildNumber: 9, label: "app #9" }]
    ]);
    completionTracker.getObservedBuildState.mockReturnValue("following");
    actions.postBuildFollowState();
    assert.deepEqual(posted.at(-1), {
      type: "buildFollowingChanged",
      followTargetToken: state.followTargetToken,
      following: true,
      loadToken: 1,
      buildNumber: 9
    });
    assert.deepEqual(statusRefreshes, []);
  });

  it("uses the numbered panel URL when Jenkins advertises a different controller path", () => {
    const buildUrl = "https://jenkins.example/view/job/job/app/10/";
    const { actions, completionTracker, state } = createActions({
      details: { number: 10, url: "https://internal/job/other/10/", building: true },
      buildUrl
    });
    actions.postBuildFollowState();
    actions.handleSetBuildFollowing({
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      following: true,
      loadToken: 1,
      buildNumber: 10
    });
    assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [
      [
        {
          environment,
          buildNumber: 10,
          buildUrl,
          observedUrl: buildUrl,
          label: "app #10"
        }
      ]
    ]);
  });

  it.each(["10/", "lastBuild/"])(
    "uses a public %s panel URL when the internal job prefix has two interpretations",
    (suffix) => {
      const publicEnvironment = { ...environment, url: "https://public/job/team/" };
      const buildUrl = "https://public/job/team/job/app/10/";
      const { actions, completionTracker, state } = createActions({
        environment: publicEnvironment,
        buildUrl: `https://public/job/team/job/app/${suffix}`,
        details: {
          number: 10,
          url: "http://internal/job/team/job/app/10/",
          building: true,
          queueId: 77
        }
      });
      actions.postBuildFollowState();
      actions.handleSetBuildFollowing({
        type: "setBuildFollowing",
        followTargetToken: state.followTargetToken,
        following: true,
        loadToken: 1,
        queueId: 77,
        buildNumber: 10
      });
      assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [
        [
          {
            environment: publicEnvironment,
            buildNumber: 10,
            buildUrl,
            observedUrl: `https://public/job/team/job/app/${suffix}`,
            label: "app #10",
            queueId: 77
          }
        ]
      ]);
    }
  );

  it.each([
    ["view/team/custom-runs/lastBuild/", "job/app/42/", "app #42"],
    ["view/team/custom-runs/42/", "view/team/custom-runs/42/", "#42"],
    ["job/matrix/os=linux/lastBuild/", "job/matrix/os=linux/42/", "matrix/os=linux #42"]
  ])("resolves a panel opened at %s to its corroborated run", (route, expectedRun, label) => {
    const { actions, completionTracker, state } = createActions({
      buildUrl: environment.url + route,
      details: { number: 42, url: "/job/app/42/", building: true }
    });
    actions.postBuildFollowState();
    actions.handleSetBuildFollowing({
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      loadToken: 1,
      following: true,
      buildNumber: 42
    });
    assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [
      [
        {
          environment,
          buildUrl: environment.url + expectedRun,
          observedUrl: environment.url + route,
          buildNumber: 42,
          label
        }
      ]
    ]);
  });

  it("follows and matches completion at the custom Run endpoint returned by a job permalink", () => {
    const buildUrl = `${environment.url}job/app/custom-runs/42/`;
    const panelUrl = `${environment.url}job/app/lastBuild/`;
    const { actions, state, completionTracker, posted } = createActions({
      buildUrl: panelUrl,
      details: { number: 42, url: buildUrl, building: true, displayName: "app #42" }
    });
    actions.postBuildFollowState();
    actions.handleSetBuildFollowing({
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      loadToken: 1,
      following: true,
      buildNumber: 42
    });
    const target = {
      environment,
      buildNumber: 42,
      buildUrl,
      observedUrl: panelUrl,
      label: "app #42"
    };
    assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [[target]]);
    state.recordFollowedBuildCompletion({ ...target, result: "SUCCESS" });
    actions.postBuildFollowState();
    assert.equal(posted.at(-1)?.type, "buildFollowingChanged");
    assert.equal(state.getRunningFollowTarget(), undefined);
  });

  it("binds delayed Follow and Stop clicks to one display of an exact custom endpoint", () => {
    const job = `${environment.url}job/app/`;
    const run = (path: string) => ({ number: 9, url: `${job}${path}/9/`, building: true });
    const first = run("custom-runs");
    const second = run("other-runs");
    const { actions, state, posted, completionTracker } = createActions({
      buildUrl: `${job}lastBuild/`,
      details: first
    });
    const click = (followTargetToken: number) => {
      const message = {
        type: "setBuildFollowing" as const,
        loadToken: 1,
        buildNumber: 9,
        followTargetToken
      };
      actions.handleSetBuildFollowing({ ...message, following: true });
      actions.handleSetBuildFollowing({ ...message, following: false });
    };
    const header = () => {
      actions.postBuildFollowState();
      const published = posted.at(-1);
      assert.ok(published?.type === "buildFollowingChanged" && published.buildNumber === 9);
      return published.followTargetToken;
    };
    click(state.followTargetToken);
    const tokenA = header();
    state.updateDetails({ ...first, displayName: "A renamed" });
    assert.equal(header(), tokenA);
    state.updateDetails(second);
    click(tokenA);
    click(state.followTargetToken);
    const tokenB = header();
    assert.notEqual(tokenA, tokenB);
    click(tokenA);
    state.updateDetails(first);
    const newTokenA = header();
    assert.notEqual(newTokenA, tokenA);
    click(tokenB);
    click(tokenA);
    assert.equal(completionTracker.followObservedBuild.mock.calls.length, 0);
    assert.equal(completionTracker.stopFollowingObservedBuild.mock.calls.length, 0);
    click(newTokenA);
    const target = state.getRunningFollowTarget();
    assert.equal(target?.buildUrl, first.url);
    assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [[target]]);
    assert.deepEqual(completionTracker.stopFollowingObservedBuild.mock.calls, [[target]]);
  });

  it("pins a permalink to its displayed run and rejects clicks after the permalink advances", () => {
    const details = { number: 10, url: "http://internal/job/app/10/", building: true };
    const { actions, completionTracker, posted, state } = createActions({
      details,
      buildUrl: "https://jenkins.example/job/app/lastBuild/"
    });
    actions.postBuildFollowState();
    const message = {
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      following: true,
      loadToken: 1,
      buildNumber: 10
    } as const;
    actions.handleSetBuildFollowing(message);
    actions.handleSetBuildFollowing({ ...message, following: false });
    const targetUrl = "https://jenkins.example/job/app/10/";
    assert.deepEqual(completionTracker.followObservedBuild.mock.calls, [
      [
        {
          environment,
          buildNumber: 10,
          buildUrl: targetUrl,
          observedUrl: "https://jenkins.example/job/app/lastBuild/",
          label: "app #10"
        }
      ]
    ]);
    assert.deepEqual(completionTracker.getObservedBuildState.mock.calls, [
      [
        {
          environment,
          buildUrl: targetUrl,
          observedUrl: "https://jenkins.example/job/app/lastBuild/",
          buildNumber: 10,
          label: "app #10"
        }
      ]
    ]);
    assert.deepEqual(completionTracker.stopFollowingObservedBuild.mock.calls, [
      [
        {
          environment,
          buildUrl: targetUrl,
          observedUrl: "https://jenkins.example/job/app/lastBuild/",
          buildNumber: 10,
          label: "app #10"
        }
      ]
    ]);

    state.updateDetails({ ...details, number: 11, url: "http://internal/job/app/11/" });
    actions.postBuildFollowState();
    actions.handleSetBuildFollowing(message);
    actions.handleSetBuildFollowing({ ...message, following: false });
    assert.equal(completionTracker.followObservedBuild.mock.calls.length, 1);
    assert.equal(completionTracker.stopFollowingObservedBuild.mock.calls.length, 1);
    assert.deepEqual(posted.at(-1), {
      type: "buildFollowingChanged",
      followTargetToken: state.followTargetToken,
      loadToken: 1,
      buildNumber: 11,
      following: false
    });
  });

  it("hides Follow if the loaded details cannot identify a numbered run", () => {
    const { actions, completionTracker, posted, state } = createActions({
      details: { number: 10, building: true },
      buildUrl: "https://jenkins.example/job/app/unrecognizedAlias/"
    });
    actions.postBuildFollowState();
    actions.handleSetBuildFollowing({
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      loadToken: 1,
      buildNumber: 10,
      following: true
    });
    assert.deepEqual(posted, [
      {
        type: "buildFollowingChanged",
        followTargetToken: state.followTargetToken,
        loadToken: 1,
        buildNumber: null,
        following: false
      }
    ]);
    assert.equal(completionTracker.followObservedBuild.mock.calls.length, 0);
    assert.equal(completionTracker.getObservedBuildState.mock.calls.length, 0);
  });

  it("ignores a follow received after the build finished", () => {
    const { actions, completionTracker, state } = createActions();
    actions.handleSetBuildFollowing({
      type: "setBuildFollowing",
      followTargetToken: state.followTargetToken,
      loadToken: 1,
      buildNumber: 9,
      following: true
    });
    assert.equal(completionTracker.followObservedBuild.mock.calls.length, 0);
  });
});

describe("BuildDetailsPanelActions", () => {
  beforeEach(() => {
    warningPrompts.length = 0;
    errorMessages.length = 0;
    infoMessages.length = 0;
    warningResponse = undefined;
  });

  it.each([false, true])("downloads the current build archive (running: %s)", async (building) => {
    const { actions, artifactRequests } = createActions({
      details: { number: 9, fullDisplayName: " app #9 ", building }
    });
    await actions.handleDownloadAllArtifacts();
    assert.deepEqual(artifactRequests, [
      {
        action: "downloadAll",
        environment,
        buildUrl: "https://jenkins.example/job/app/9/",
        buildNumber: 9,
        jobNameHint: "app #9"
      }
    ]);
  });

  it("ignores archive requests when its handler is unavailable", async () => {
    const { actions, artifactRequests } = createActions({ withoutArtifactHandler: true });
    await actions.handleDownloadAllArtifacts();
    assert.deepEqual(artifactRequests, []);
  });

  it("confirms before restarting from a stage and does nothing when dismissed", async () => {
    const { actions, restarts } = createActions();

    await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });

    assert.deepEqual(restarts, []);
    assert.equal(
      warningPrompts[0]?.message,
      "Restart app #9 from stage “Deploy”? This starts a new build."
    );
    assert.deepEqual(warningPrompts[0]?.options, { modal: true });
    assert.deepEqual(warningPrompts[0]?.items, ["Restart"]);
  });

  it("restarts from the stage once confirmed", async () => {
    const { actions, restarts } = createActions();
    warningResponse = "Restart";

    await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });

    assert.deepEqual(restarts, ["Deploy"]);
    assert.deepEqual(infoMessages, ['Requested restart from stage "Deploy" for app #9.']);
  });

  it.each(["job/app/0", "view/team/custom-runs/job/app/0"])(
    "restarts verified build zero at its literal %s endpoint, refreshes, and reports the result",
    async (route) => {
      const mounted = { ...environment, url: "https://public/job/team/" };
      const literal = `${mounted.url}${route}/`;
      const followUp = { prepare: vi.fn(), announceAndFollow: vi.fn() };
      const submit = vi.fn();
      const { actions, fullEnvironmentRefresh } = createActions({
        environment: mounted,
        buildUrl: `${literal}?v=1#status`,
        details: {
          number: 0,
          building: false,
          result: "FAILURE",
          url: "http://internal/job/app/0/"
        },
        buildFollowUp: followUp,
        onRestart: submit
      });
      warningResponse = "Restart";
      await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });
      assert.deepEqual(submit.mock.calls, [[literal]]);
      assert.equal(followUp.prepare.mock.calls.length, 0);
      assert.equal(followUp.announceAndFollow.mock.calls.length, 0);
      assert.deepEqual(fullEnvironmentRefresh.mock.calls, [
        [{ environmentId: mounted.environmentId }]
      ]);
      assert.deepEqual(infoMessages, ['Requested restart from stage "Deploy" for #0.']);
    }
  );

  it.each([
    ["job/app/0/", 1],
    ["job/app/1/", 0],
    ["job/app/lastFailedBuild/", 0],
    ["job/app/7/artifact/0/", 0],
    ["https://internal/job/app/0/", 0]
  ] as const)(
    "rejects restart on %s when the loaded #%s has no verified target",
    async (path, number) => {
      const { actions, restarts, fullEnvironmentRefresh } = createActions({
        buildUrl: new URL(path, environment.url).href,
        details: {
          number,
          building: false,
          result: "FAILURE",
          url: `${environment.url}job/app/${number}/`
        }
      });
      warningResponse = "Restart";
      await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });
      assert.deepEqual(restarts, []);
      assert.equal(warningPrompts.length, 0);
      assert.equal(fullEnvironmentRefresh.mock.calls.length, 0);
      assert.match(errorMessages[0] ?? "", /identify the build to restart/);
    }
  );

  it.each([
    ["job/app/lastFailedBuild/", "job/app/9/"],
    ["view/team/custom-runs/job/matrix/os=linux/9/", "view/team/custom-runs/job/matrix/os=linux/9/"]
  ])("prepares and submits the confirmed numbered run for %s", async (route, runRoute) => {
    const mount = { ...environment, url: "https://public/job/team/" };
    const details = {
      number: 9,
      building: false,
      result: "FAILURE",
      url: "http://internal/job/team/job/app/9/"
    };
    const prepare = vi.fn();
    const submit = vi.fn();
    const { actions, state } = createActions({
      environment: mount,
      buildUrl: mount.url + route,
      details,
      buildFollowUp: { prepare },
      onRestart: submit
    });
    warningResponse = "Restart";
    const request = actions.handleRestartPipelineFromStage({ stageName: "Deploy" });
    assert.equal(warningPrompts.length, 1);
    state.updateDetails({ ...details, number: 10, url: `${mount.url}job/app/10/` });
    await request;

    const confirmed = mount.url + runRoute;
    assert.equal(prepare.mock.calls[0]?.[0].sourceBuildUrl, confirmed);
    assert.deepEqual(submit.mock.calls, [[confirmed]]);
  });

  it("leaves an unidentifiable restart unsubmitted", async () => {
    const prepare = vi.fn();
    const { actions, restarts } = createActions({
      buildUrl: `${environment.url}view/team/custom-runs/lastFailedBuild/`,
      buildFollowUp: { prepare }
    });
    warningResponse = "Restart";
    await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });

    assert.match(errorMessages[0] ?? "", /identify the build to restart/);
    assert.equal(warningPrompts.length, 0);
    assert.equal(prepare.mock.calls.length, 0);
    assert.deepEqual(restarts, []);
  });

  it("prepares, restarts, then announces and follows the restarted build", async () => {
    const calls: string[] = [];
    const prepared = { request: { kind: "cause" }, causeOrigin: { kind: "cause", label: "app" } };
    const announced: Array<{ prepared: unknown; options: Record<string, unknown> }> = [];
    const buildFollowUp = {
      prepare: async (request: unknown) => {
        calls.push("prepare");
        assert.deepEqual(request, {
          kind: "cause",
          environment,
          sourceBuildUrl: "https://jenkins.example/job/app/9/",
          sourceUrlKind: "configured",
          sourceBuildNumber: 9,
          cause: "restart",
          stageName: "Deploy"
        });
        return prepared;
      },
      announceAndFollow: (value: unknown, options: Record<string, unknown>) => {
        calls.push("announceAndFollow");
        announced.push({ prepared: value, options });
      }
    };
    const { actions, restarts } = createActions({
      buildFollowUp,
      onRestart: () => calls.push("restart")
    });
    warningResponse = "Restart";

    await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });

    assert.deepEqual(restarts, ["Deploy"]);
    assert.deepEqual(calls, ["prepare", "restart", "announceAndFollow"]);
    assert.deepEqual(infoMessages, []);
    assert.equal(announced.length, 1);
    assert.equal(announced[0]?.prepared, prepared);
    assert.equal(
      announced[0]?.options.requestedMessage,
      'Requested restart from stage "Deploy" for app #9'
    );
    assert.equal(typeof announced[0]?.options.refresh, "function");
    assert.deepEqual(Object.keys(announced[0]?.options ?? {}).sort(), [
      "refresh",
      "requestedMessage"
    ]);
  });

  it("reports pending-input completion after the confirmation is dismissed", async () => {
    const { actions, posted, rejects } = createActions();

    await actions.handleRejectInput({ inputId: "deploy" });

    assert.deepEqual(rejects, []);
    assert.deepEqual(posted, [{ type: "pendingInputActionComplete", inputId: "deploy" }]);
  });

  it("reports pending-input completion even when Jenkins rejects the request", async () => {
    const { actions, posted } = createActions({ rejectError: new Error("HTTP 500") });
    warningResponse = "Reject";

    await actions.handleRejectInput({ inputId: "deploy" });

    assert.deepEqual(posted, [{ type: "pendingInputActionComplete", inputId: "deploy" }]);
  });

  it("reports completion after an approval succeeds", async () => {
    const { actions, posted } = createActions();

    await actions.handleApproveInput({ inputId: "deploy" });

    assert.deepEqual(posted, [{ type: "pendingInputActionComplete", inputId: "deploy" }]);
  });

  it("opens the panel build's Jenkins input page for browser-only inputs", async () => {
    openedUrls.length = 0;
    const { actions, posted } = createActions();

    await actions.handleOpenPendingInputInJenkins({ inputId: "deploy" });

    assert.deepEqual(openedUrls, ["https://jenkins.example/job/app/9/input/"]);
    assert.deepEqual(errorMessages, []);
    // Nothing was marked as processing, so no completion is posted.
    assert.deepEqual(posted, []);
  });

  it("reports an error instead of opening Jenkins before the build URL is known", async () => {
    openedUrls.length = 0;
    const { actions } = createActions({ withoutBuildUrl: true });

    await actions.handleOpenPendingInputInJenkins({ inputId: "deploy" });

    assert.deepEqual(openedUrls, []);
    assert.deepEqual(errorMessages, ["Build details are not ready for input approval."]);
  });
});

describe("BuildDetailsPanelActions build management", () => {
  beforeEach(() => {
    errorMessages.length = 0;
  });

  const complete = { type: "buildManagementActionComplete" };

  it.each([
    [{ type: "setKeepForever", keep: true }, "setKeepForever", true],
    [{ type: "setKeepForever", keep: false }, "setKeepForever", false],
    [{ type: "editBuild" }, "editBuild", undefined],
    [{ type: "deleteBuild" }, "deleteBuild", undefined]
  ] as const)(
    "routes %o to the shared workflow with the panel's build",
    async (message, method, keep) => {
      const { actions, workflowCalls, posted } = createActions();

      await actions.handleBuildManagement(message);

      const target = {
        environment,
        buildUrl: "https://jenkins.example/job/app/9/",
        label: "app #9",
        isBuilding: false
      };
      assert.deepEqual(workflowCalls, [
        keep === undefined ? { method, target } : { method, target, keep }
      ]);
      assert.deepEqual(posted, [complete]);
    }
  );

  it("labels the target from the display name or number and marks running builds", async () => {
    const named = createActions({ details: { number: 9, displayName: "#9", building: true } });
    await named.actions.handleBuildManagement({ type: "editBuild" });
    assert.deepEqual(named.workflowCalls[0]?.target, {
      environment,
      buildUrl: "https://jenkins.example/job/app/9/",
      label: "#9",
      isBuilding: true
    });

    const numbered = createActions({ details: { number: 9 } });
    await numbered.actions.handleBuildManagement({ type: "editBuild" });
    assert.equal((numbered.workflowCalls[0]?.target as { label?: string })?.label, "#9");
  });

  it("applies the keep state from the message instead of the panel's loaded state", async () => {
    const kept = createActions({
      details: { number: 9, fullDisplayName: "app #9", building: false, keepLog: true }
    });
    await kept.actions.handleBuildManagement({ type: "setKeepForever", keep: true });
    assert.equal(kept.workflowCalls[0]?.method, "setKeepForever");
    assert.equal(kept.workflowCalls[0]?.keep, true);

    const notKept = createActions();
    await notKept.actions.handleBuildManagement({ type: "setKeepForever", keep: false });
    assert.equal(notKept.workflowCalls[0]?.keep, false);
  });

  it("refreshes the build status only when Jenkins changed", async () => {
    for (const workflowResult of ["unchanged", "cancelled", "failed", "deleted"] as const) {
      const { actions, statusRefreshes, posted } = createActions({ workflowResult });
      await actions.handleBuildManagement({ type: "setKeepForever", keep: true });
      assert.deepEqual(statusRefreshes, [], workflowResult);
      assert.deepEqual(posted, [complete], workflowResult);
    }

    const changed = createActions({ workflowResult: "changed" });
    await changed.actions.handleBuildManagement({ type: "setKeepForever", keep: true });
    assert.deepEqual(changed.statusRefreshes, [1]);
    assert.deepEqual(changed.posted, [complete]);
  });

  it("reports completion even when the workflow throws", async () => {
    const { actions, posted } = createActions({ workflowError: new Error("boom") });

    await actions.handleBuildManagement({ type: "deleteBuild" });

    assert.deepEqual(errorMessages, ["Build management action failed: boom"]);
    assert.deepEqual(posted, [complete]);
  });

  it("explains when the build details are not ready", async () => {
    for (const options of [{ details: undefined }, { withoutWorkflow: true }]) {
      errorMessages.length = 0;
      const { actions, posted, workflowCalls } = createActions(options);

      await actions.handleBuildManagement({ type: "editBuild" });

      assert.deepEqual(workflowCalls, []);
      assert.deepEqual(errorMessages, ["Build details are not ready."]);
      assert.deepEqual(posted, [complete]);
    }
  });
});

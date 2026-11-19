import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";
import { EventEmitter } from "./helpers/vscodeStub";

let resolveInformationMessage: ((selection: string | undefined) => void) | undefined;
const showWarningMessage = vi.fn();
let configuredCaseLogs = false;

vi.doMock("vscode", () => ({
  EventEmitter,
  StatusBarAlignment: { Left: 1 },
  workspace: {
    getConfiguration: () => ({
      get: <T>(key: string, defaultValue?: T): T =>
        (key === "buildDetails.testReport.includeCaseLogs" ? configuredCaseLogs : defaultValue) as T
    })
  },
  window: {
    createQuickPick: () => {
      const accept = new EventEmitter<void>();
      const hide = new EventEmitter<void>();
      const picker = {
        items: [] as unknown[],
        selectedItems: [] as unknown[],
        onDidAccept: accept.event,
        onDidHide: hide.event,
        show: () =>
          queueMicrotask(() => {
            picker.selectedItems = picker.items.slice(0, 1);
            accept.fire();
          }),
        hide: () => hide.fire(),
        dispose: () => {
          accept.dispose();
          hide.dispose();
        }
      };
      return picker;
    },
    createStatusBarItem: () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }),
    showWarningMessage,
    showInformationMessage: () =>
      new Promise<string | undefined>((resolve) => {
        resolveInformationMessage = resolve;
      })
  }
}));

const openedUrls: string[] = [];

vi.doMock("../src/ui/OpenExternalUrl", () => ({
  openExternalHttpUrlWithWarning: async (url: string) => {
    openedUrls.push(url);
  }
}));

const { BuildDetailsPanelRuntime } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelRuntime"
);
const { BuildDetailsPanelController } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelController"
);
const { createBuildDetailsMessageRouter } = await import(
  "../src/panels/buildDetails/BuildDetailsMessageBindings"
);

const { buildDetailsReducer, buildInitialState } = await import(
  "../src/panels/buildDetails/webview/state/buildDetailsState"
);
const { parseBuildDetailsOutgoingMessage } = await import(
  "../src/panels/buildDetails/shared/BuildDetailsPanelMessages"
);

function reduceConsoleMessages(
  model: Parameters<typeof buildInitialState>[0],
  messages: unknown[]
): ReturnType<typeof buildInitialState> {
  // This fixture uses only <pre>text</pre>; supply its text node to the real HTML reducer.
  vi.stubGlobal("Node", { TEXT_NODE: 3, ELEMENT_NODE: 1 });
  vi.stubGlobal(
    "DOMParser",
    class {
      parseFromString(html: string) {
        return {
          body: { childNodes: [{ nodeType: 3, textContent: html.replace(/<\/?pre>/g, "") }] }
        };
      }
    }
  );
  try {
    let state = buildInitialState(model);
    for (const value of messages) {
      const message = parseBuildDetailsOutgoingMessage(value);
      if (message) {
        state = buildDetailsReducer(
          state,
          message.type === "updateDetails" ? { type: "updateDetails", payload: message } : message
        );
      }
    }
    return state;
  } finally {
    vi.unstubAllGlobals();
  }
}

function acknowledgeWebview(
  controller: InstanceType<typeof BuildDetailsPanelController>,
  loadToken = controller.getLoadToken(),
  documentId = "first"
): void {
  const router = createBuildDetailsMessageRouter({ controller } as Parameters<
    typeof createBuildDetailsMessageRouter
  >[0]);
  router.route({ type: "buildDetailsReady", loadToken, documentId });
}

const { BuildDetailsPanelView } = await import("../src/panels/buildDetails/BuildDetailsPanelView");
const { BuildDetailsPanelActions } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelActions"
);
const { BuildCompletionTracker } = await import(
  "../src/services/buildFollow/BuildCompletionTracker"
);

describe("BuildDetailsPanelRuntime", () => {
  it("delivers the anonymous panel result when verification announces a different replacement result", async () => {
    const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
    const url = `${environment.url}job/app/42/`;
    const state = new BuildDetailsPanelState();
    state.resetForLoad(environment, url, "nonce");
    const tracker = {
      claimPanelCompletion: vi.fn(async () => {
        state.recordFollowedBuildCompletion({
          environment,
          buildUrl: url,
          buildNumber: 42,
          queueId: 18,
          label: "app #42",
          result: "SUCCESS"
        });
        return { disposition: "panel" as const };
      }),
      observeBuildIdentity: vi.fn(),
      observeRunningBuild: vi.fn(),
      rejectMismatchedBuild: vi.fn(),
      recordPanelCompletion: vi.fn()
    };
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
      const toast = runtime.showCompletionToast({
        url,
        number: 42,
        building: false,
        result: "FAILURE"
      });
      await Promise.resolve();
      assert.equal(tracker.recordPanelCompletion.mock.calls.length, 1);
      assert.equal(tracker.recordPanelCompletion.mock.calls[0][0].result, "FAILURE");
      resolveInformationMessage?.(undefined);
      await toast;
    } finally {
      runtime.dispose();
    }
  });

  it.each(["delivered", "claimed by tracker"])(
    "reconciles a number-only terminal result with a later queue ID only when its standalone toast was %s",
    async (first) => {
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const url = `${environment.url}job/app/42/`;
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, url, "nonce");
      const tracker = {
        claimPanelCompletion: vi
          .fn()
          .mockResolvedValueOnce({
            disposition: first === "claimed by tracker" ? "tracker" : "panel"
          })
          .mockResolvedValue({ disposition: "panel" }),
        observeBuildIdentity: vi.fn(),
        observeRunningBuild: vi.fn(),
        rejectMismatchedBuild: vi.fn(),
        recordPanelCompletion: vi.fn()
      };
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
      const terminal = { url, number: 42, building: false, result: "FAILURE" };
      try {
        for (const details of [terminal, { ...terminal, queueId: 17 }]) {
          const toast = runtime.showCompletionToast(details);
          await Promise.resolve();
          resolveInformationMessage?.(undefined);
          await toast;
        }
        assert.equal(tracker.recordPanelCompletion.mock.calls.length, 1);
        assert.equal(
          tracker.recordPanelCompletion.mock.calls[0][0].queueId,
          first === "delivered" ? undefined : 17
        );
      } finally {
        runtime.dispose();
      }
    }
  );

  it.each([
    { phase: "initial", building: false, number: 42, selector: "42" },
    { phase: "initial", building: undefined, number: 42, selector: "42" },
    { phase: "initial", building: false, number: 43, selector: "42" },
    { phase: "refresh", building: false, number: 42, selector: "42" },
    { phase: "initial", building: false, number: 42, selector: "lastBuild" }
  ])(
    "checks a pending Open against a fresh $phase panel observation from $selector/ (number $number, building $building)",
    async ({ phase, building, number, selector }) => {
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const url = `${environment.url}job/app/42/`;
      const replacement = {
        number,
        url: `${environment.url}job/app/${number}/`,
        queueId: 18,
        building
      };
      const prior = { number: 42, url, queueId: 17, building: true };
      const opened = vi.fn();
      const refresh = vi.fn();
      let release!: (status: JenkinsBuildDetails) => void;
      let ready!: () => void;
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const tracker = new BuildCompletionTracker(
        {
          getQueueItem: vi.fn(),
          getBuildDetails: () =>
            new Promise((resolve) => {
              release = resolve;
              ready();
            })
        },
        {
          isCurrentController: () => true,
          refreshEnvironment: refresh,
          showBuildDetails: opened,
          previewLog: vi.fn()
        }
      );
      const claim = vi.spyOn(tracker, "claimPanelCompletion");
      const getBuildDetails = vi.fn().mockResolvedValue(replacement);
      if (phase === "refresh") getBuildDetails.mockResolvedValueOnce(prior);
      const backend = {
        status: { getBuildDetails, getWorkflowRun: vi.fn() },
        pendingInputs: { getPendingInputActions: vi.fn(async () => []) },
        tests: { getTestReport: vi.fn() },
        restart: { getRestartFromStageInfo: vi.fn() },
        coverage: { discoverCoverageActionPath: vi.fn() },
        console: {}
      };
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const controller = new BuildDetailsPanelController(
        { visible: true, webview: { postMessage: vi.fn() } } as never,
        {} as never,
        { clearCoverageContext: vi.fn(), deactivateOwner: vi.fn() } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        tracker
      );
      const evidence = vi.spyOn(tracker, "observeBuildIdentity");
      const mismatch = vi.spyOn(tracker, "rejectMismatchedBuild");
      const label = "app #42";
      try {
        tracker.follow({ environment, buildUrl: url, buildNumber: 42, queueId: 17, label });
        const open = tracker.showFollowedBuilds();
        await started;
        const panelUrl = `${environment.url}job/app/${selector}/`;
        await controller.load(backend as never, environment, panelUrl);
        if (phase === "refresh") await controller.refreshBuildStatus(controller.getLoadToken());
        assert.ok(claim.mock.calls.every(([request]) => request.subscribersOnly));
        if (number === 42) {
          const [seen] = evidence.mock.lastCall ?? [];
          assert.equal(seen?.observedUrl, panelUrl);
          assert.equal(seen?.buildUrl, url);
          assert.equal(seen?.queueId, 18);
          assert.ok(seen?.requestOrder);
        } else {
          const args = mismatch.mock.lastCall;
          assert.deepEqual(args?.slice(0, 3), [environment, panelUrl, number]);
          assert.ok(args?.[3]);
        }
        release({ ...prior, building: false, result: "SUCCESS" });
        await open;
        assert.equal(opened.mock.calls.length, selector === "lastBuild" ? 1 : 0);
        assert.equal(refresh.mock.calls.length, 1);
        assert.equal(tracker.count, 0);
      } finally {
        controller.dispose();
        tracker.dispose();
        render.mockRestore();
        assets.mockRestore();
      }
    }
  );

  it.each([
    "poll first",
    "refresh first",
    "older completion",
    "older anonymous completion",
    "replacement completed",
    "new load"
  ])("keeps the latest displayed run and rejects delayed Follow clicks (%s)", async (order) => {
    vi.useFakeTimers();
    const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
    const url = `${environment.url}job/app/42/`;
    const makeRun = (queueId: number, building = true) => ({
      number: 42,
      url,
      queueId,
      building,
      displayName: `run ${queueId}`,
      result: building ? undefined : "SUCCESS"
    });
    const original = makeRun(17);
    const pollStatus =
      order === "older anonymous completion"
        ? { ...makeRun(17, false), queueId: undefined }
        : makeRun(17, order !== "older completion");
    const replacement = makeRun(18, order !== "replacement completed");
    const received = vi.fn();
    const tracker = new BuildCompletionTracker(
      {
        getQueueItem: vi.fn(),
        getBuildDetails: vi.fn(async () => replacement)
      },
      {
        isCurrentController: () => true,
        refreshEnvironment: vi.fn(),
        showBuildDetails: vi.fn(),
        previewLog: vi.fn()
      }
    );
    tracker.onDidNotifyCompletion(received);
    const evidence = vi.spyOn(tracker, "observeBuildIdentity");
    const getBuildDetails = vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(pollStatus)
      .mockResolvedValue(replacement);
    let release!: () => void;
    const pendingInput = vi
      .fn()
      .mockResolvedValueOnce([{ id: "approval", parameters: [] }])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve([{ id: "stale approval", parameters: [] }]);
          })
      )
      .mockResolvedValue([]);
    const getTestReport = vi.fn();
    const backend = {
      status: { getBuildDetails, getWorkflowRun: vi.fn() },
      pendingInputs: { getPendingInputActions: pendingInput },
      tests: { getTestReport },
      restart: {},
      coverage: {},
      console: {}
    };
    const assets = vi
      .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
      .mockReturnValue({} as never);
    const render = vi
      .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
      .mockImplementation(() => {});
    const posted = vi.fn();
    const panel = { title: "", visible: true, webview: { postMessage: posted } };
    const changed = vi.fn((_details: JenkinsBuildDetails) =>
      actions.postBuildFollowState("details")
    );
    const controller: InstanceType<typeof BuildDetailsPanelController> =
      new BuildDetailsPanelController(
        panel as never,
        {} as never,
        { clearCoverageContext: vi.fn(), deactivateOwner: vi.fn() } as never,
        undefined,
        changed,
        undefined,
        undefined,
        undefined,
        tracker
      );
    const actions: InstanceType<typeof BuildDetailsPanelActions> = new BuildDetailsPanelActions({
      controller,
      completionTracker: tracker,
      getArtifactActionHandler: () => undefined,
      getRefreshHost: () => undefined,
      getTestSourceNavigationUiService: () => undefined,
      getBuildManagementWorkflow: () => undefined,
      getConsoleExporter: () => {
        throw new Error("unused");
      }
    });
    tracker.onDidChange(() => actions.postBuildFollowState());
    const lastFollow = () =>
      posted.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "buildFollowingChanged")
        .at(-1);
    try {
      await controller.load(backend as never, environment, url);
      const oldToken = controller.getLoadToken();
      const click = {
        type: "setBuildFollowing" as const,
        loadToken: oldToken,
        followTargetToken: lastFollow()?.followTargetToken,
        buildNumber: 42,
        queueId: 17,
        following: true
      };
      if (order === "older completion") actions.handleSetBuildFollowing(click);
      await vi.advanceTimersByTimeAsync(5000);
      assert.equal(pendingInput.mock.calls.length, 2);
      if (order === "poll first") {
        release();
        await vi.advanceTimersByTimeAsync(0);
        assert.equal(controller.getCurrentDetails()?.queueId, 17);
      }
      if (order === "new load") await controller.load(backend as never, environment, url);
      else await controller.refreshBuildStatus(oldToken);
      assert.equal(controller.getCurrentDetails()?.queueId, 18);
      assert.equal(panel.title, "Build Details - run 18");
      if (order === "older anonymous completion")
        actions.handleSetBuildFollowing({
          ...click,
          queueId: 18,
          followTargetToken: lastFollow()?.followTargetToken
        });
      posted.mockClear();
      if (order !== "poll first") release();
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(changed.mock.lastCall?.[0].queueId, 18);
      assert.equal(controller.getCurrentDetails()?.building, replacement.building);
      assert.equal(controller.getCurrentDetails()?.queueId, 18);
      assert.equal(panel.title, "Build Details - run 18");
      assert.equal(getTestReport.mock.calls.length, replacement.building ? 0 : 1);
      if (order === "refresh first" || order === "older completion")
        assert.ok(
          evidence.mock.calls.some(
            ([target]) => target.queueId === 17 && target.requestOrder !== undefined
          )
        );
      if (order === "older completion") {
        assert.equal(received.mock.calls.length, 1);
        assert.equal(received.mock.calls[0][0].queueId, 17);
      }
      if (order === "older anonymous completion") {
        assert.equal(tracker.isFollowingQueueItem(environment, 18), true);
        assert.equal(received.mock.calls.length, 0);
      }
      actions.postBuildFollowState();
      assert.equal(lastFollow()?.queueId, replacement.building ? 18 : undefined);
      actions.handleSetBuildFollowing(click);
      assert.equal(tracker.isFollowingQueueItem(environment, 17), false);
      actions.handleSetBuildFollowing({
        ...click,
        queueId: 18,
        followTargetToken: lastFollow()?.followTargetToken,
        loadToken: controller.getLoadToken()
      });
      assert.equal(tracker.isFollowingQueueItem(environment, 18), replacement.building);
      actions.handleSetBuildFollowing({ ...click, following: false });
      assert.equal(tracker.isFollowingQueueItem(environment, 18), replacement.building);
    } finally {
      controller.dispose();
      tracker.dispose();
      render.mockRestore();
      assets.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([
    { scenario: "same run", html: false },
    { scenario: "same run", html: true },
    { scenario: "recycled number", html: false },
    { scenario: "recycled number", html: true },
    { scenario: "different numbered endpoint", html: true },
    { scenario: "newer visibility snapshot", html: false }
  ])(
    "renders and streams the current console after a status overtakes the initial load ($scenario, HTML $html)",
    async ({ scenario, html }) => {
      vi.useFakeTimers();
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const panelUrl = `${environment.url}job/app/lastBuild/`;
      const initialUrl = `${environment.url}job/app/42/`;
      const replacement =
        scenario === "recycled number" || scenario === "different numbered endpoint";
      const finalUrl =
        scenario === "different numbered endpoint"
          ? `${environment.url}job/app/custom-runs/42/`
          : initialUrl;
      const initial = { number: 42, url: initialUrl, queueId: 17, building: true };
      const final = {
        ...initial,
        url: finalUrl,
        queueId: replacement ? 18 : 17,
        building: scenario !== "newer visibility snapshot"
      };
      const getBuildDetails = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(final);
      let renderReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        renderReady = resolve;
      });
      let releaseTail!: () => void;
      const heldTail = new Promise<void>((resolve) => {
        releaseTail = resolve;
      });
      let started!: () => void;
      const firstTail = new Promise<void>((resolve) => {
        started = resolve;
      });
      let reads = 0;
      const prefix = scenario === "same run" ? "first lines" : "current run first lines";
      let liveTail = prefix;
      const getConsoleTextTail = vi.fn(async (_environment: unknown, _url: string) => {
        const first = reads++ === 0;
        const text = first ? "first lines" : liveTail;
        if (first) {
          started();
          if (replacement) await heldTail;
        }
        return {
          text,
          nextStart: text.length,
          bytesRead: text.length,
          progressiveSupported: true,
          truncated: false
        };
      });
      const delta = " plus next line";
      const getConsoleHtmlProgressive = vi.fn(
        async (_env: unknown, _url: string, start: number) => ({
          html: start === 0 ? `<b>${liveTail}</b>` : delta,
          textSizeKnown: html,
          textSize: start === 0 ? liveTail.length : start + delta.length,
          moreData: true
        })
      );
      const getConsoleTextProgressive = vi.fn(
        async (_env: unknown, _url: string, start: number) => ({
          text: delta,
          textSize: start + delta.length,
          moreData: true
        })
      );
      const backend = {
        status: { getBuildDetails, getWorkflowRun: vi.fn() },
        pendingInputs: { getPendingInputActions: vi.fn(async () => []) },
        tests: { getTestReport: vi.fn() },
        restart: {},
        coverage: { discoverCoverageActionPath: vi.fn() },
        console: { getConsoleTextTail, getConsoleHtmlProgressive, getConsoleTextProgressive }
      };
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const posted = vi.fn();
      const controller = new BuildDetailsPanelController(
        { visible: true, webview: { postMessage: posted } } as never,
        {} as never,
        {
          activateOwner: vi.fn(),
          deactivateOwner: vi.fn(),
          clearCoverageContext: vi.fn()
        } as never,
        undefined,
        undefined,
        undefined,
        () => ready
      );
      try {
        const load = controller.load(backend as never, environment, panelUrl);
        await firstTail;
        if (scenario === "newer visibility snapshot") await controller.handlePanelVisible();
        else await controller.refreshBuildStatus(controller.getLoadToken());
        renderReady();
        await load;
        releaseTail();
        if (final.building) {
          await vi.advanceTimersByTimeAsync(5000);
          assert.equal(getConsoleTextProgressive.mock.calls.length, 0);
          assert.ok(getConsoleHtmlProgressive.mock.calls.every(([, , start]) => start === 0));
        }
        acknowledgeWebview(controller);
        await vi.advanceTimersByTimeAsync(0);
        const model = render.mock.lastCall?.[0];
        assert.equal(model?.consoleText, prefix);
        assert.equal(model?.consoleHtml, html ? `<b>${prefix}</b>` : undefined);
        assert.equal(controller.getDiagnosticConsoleText(), prefix);
        assert.equal(controller.getCurrentDetails()?.queueId, final.queueId);
        assert.equal(
          controller.getRunningFollowTarget()?.queueId,
          final.building ? final.queueId : undefined
        );
        assert.deepEqual(
          getConsoleTextTail.mock.calls.map(([, url]) => url),
          scenario === "same run" ? [initialUrl] : [initialUrl, finalUrl]
        );
        if (final.building) {
          await vi.advanceTimersByTimeAsync(5000);
          const calls = html
            ? getConsoleHtmlProgressive.mock.calls
            : getConsoleTextProgressive.mock.calls;
          assert.deepEqual(calls.at(-1)?.slice(1, 3), [finalUrl, prefix.length]);
          assert.equal(getConsoleTextProgressive.mock.lastCall?.[1], finalUrl);
          assert.equal(controller.getDiagnosticConsoleText(), prefix + delta);
          // Developer: Reload Webviews renders the original HTML model again.
          liveTail = prefix + delta;
          posted.mockClear();
          acknowledgeWebview(controller, model?.loadToken, "recreated");
          await vi.advanceTimersByTimeAsync(0);
          assert.ok(posted.mock.calls.some(([m]) => m.type === "updateDetails"));
          assert.ok(
            posted.mock.calls.some(([m]) =>
              html ? m.html === `<b>${liveTail}</b>` : m.text === liveTail
            )
          );
          assert.equal(getConsoleTextTail.mock.lastCall?.[1], finalUrl);
          await vi.advanceTimersByTimeAsync(5000);
          assert.deepEqual(calls.at(-1)?.slice(1, 3), [finalUrl, liveTail.length]);
          assert.equal(controller.getDiagnosticConsoleText(), liveTail + delta);
        }
      } finally {
        renderReady();
        releaseTail();
        controller.dispose();
        assets.mockRestore();
        render.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it.each([
    { timing: "before render", html: false },
    { timing: "before render", html: true },
    { timing: "after render", html: false },
    { timing: "after render", html: true },
    { timing: "recreated during poll", html: true },
    { timing: "recreated during poll", html: false },
    { timing: "failed recreated during poll", html: true },
    { timing: "failed recreated during poll", html: false },
    { timing: "before ready", html: false },
    { timing: "before ready", html: true },
    { timing: "recycled before ready", html: true },
    { timing: "failed same run before ready", html: false },
    { timing: "failed same run before ready", html: true },
    { timing: "failed recycled before ready", html: true },
    { timing: "hidden before ready", html: false },
    { timing: "disposed before ready", html: true },
    { timing: "new load before ready", html: false },
    { timing: "hidden", html: true },
    { timing: "disposed", html: false },
    { timing: "replaced", html: true }
  ])(
    "catches up when the final poll starts before the console renders ($timing, HTML $html)",
    async ({ timing, html }) => {
      vi.useFakeTimers();
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const url = `${environment.url}job/app/custom-runs/42/`;
      const prior = { number: 42, url, queueId: 17, building: true };
      let current = prior;
      let tail = "first lines";
      const finished = "first lines — final line";
      const recreatedDuringPoll = timing.includes("recreated during poll");
      let startPoll!: () => void;
      const pollStarted = new Promise<void>((notify) => {
        startPoll = notify;
      });
      let finishPoll!: () => void;
      const pollResponse = new Promise<void>((notify) => {
        finishPoll = notify;
      });
      const getBuildDetails = vi
        .fn(async () => current)
        .mockResolvedValueOnce(prior)
        .mockResolvedValueOnce(prior)
        .mockImplementationOnce(async () => {
          startPoll();
          await pollResponse;
          return current;
        });
      let startInitial!: () => void;
      const seeded = new Promise<void>((notify) => {
        startInitial = notify;
      });
      let startFinal!: () => void;
      const finalStarted = new Promise<void>((notify) => {
        startFinal = notify;
      });
      let finishTail!: () => void;
      const finalResponse = new Promise<void>((notify) => {
        finishTail = notify;
      });
      let failTerminalTail = timing.startsWith("failed ");
      const getConsoleTextTail = vi.fn(async (_environment: unknown, _url: string) => {
        if (failTerminalTail && !current.building) throw new Error("terminal read unavailable");
        const text = tail;
        if (text === finished) {
          startFinal();
          if (timing === "disposed" || timing === "replaced") await finalResponse;
        } else startInitial();
        const bytes = Buffer.byteLength(text);
        return {
          text,
          bytesRead: bytes,
          nextStart: bytes,
          progressiveSupported: true,
          truncated: false
        };
      });
      const getConsoleHtmlProgressive = vi.fn(
        async (_environment: unknown, _url: string, start: number) => {
          if (start > 0 && recreatedDuringPoll) await pollResponse;
          return {
            html: start === 0 ? `<pre>${tail}</pre>` : tail.slice(start),
            textSize: Buffer.byteLength(tail),
            textSizeKnown: html,
            moreData: current.building
          };
        }
      );
      const getConsoleTextProgressive = vi.fn(
        async (_environment: unknown, _url: string, start: number) => {
          await pollResponse;
          return {
            text: tail.slice(start),
            textSize: Buffer.byteLength(tail),
            moreData: current.building
          };
        }
      );
      const backend = {
        status: { getBuildDetails, getWorkflowRun: vi.fn() },
        tests: { getTestReport: vi.fn() },
        coverage: { discoverCoverageActionPath: vi.fn() },
        restart: {},
        pendingInputs: { getPendingInputActions: vi.fn(async () => []) },
        console: { getConsoleTextTail, getConsoleHtmlProgressive, getConsoleTextProgressive }
      };
      let renderReady!: () => void;
      const ready = new Promise<void>((notify) => {
        renderReady = notify;
      });
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const posted = vi.fn();
      const panel = { visible: true, webview: { postMessage: posted } };
      const controller = new BuildDetailsPanelController(
        panel as never,
        {} as never,
        {
          activateOwner: vi.fn(),
          deactivateOwner: vi.fn(),
          clearCoverageContext: vi.fn()
        } as never,
        undefined,
        undefined,
        undefined,
        () => ready
      );
      try {
        const load = controller.load(
          backend as never,
          environment,
          `${environment.url}job/app/lastBuild/`
        );
        await seeded;
        await controller.handlePanelVisible();
        if (recreatedDuringPoll) {
          renderReady();
          await load;
          acknowledgeWebview(controller);
          await vi.advanceTimersByTimeAsync(0);
        }
        await vi.advanceTimersByTimeAsync(5000);
        await pollStarted;
        if (timing !== "before render") {
          renderReady();
          await load;
          assert.equal(render.mock.lastCall?.[0].consoleText, "first lines");
          if (!timing.endsWith("before ready")) {
            acknowledgeWebview(controller);
            await vi.advanceTimersByTimeAsync(0);
          }
        }
        if (recreatedDuringPoll) {
          // The old progressive request and Run read started together. The new
          // document successfully re-seeds its own cursor before that poll completes.
          assert.ok(
            html
              ? getConsoleHtmlProgressive.mock.calls.some(([, , start]) => start > 0)
              : getConsoleTextProgressive.mock.calls.length
          );
          acknowledgeWebview(controller, controller.getLoadToken(), "recreated");
          await vi.advanceTimersByTimeAsync(0);
          assert.equal(getConsoleTextTail.mock.calls.length, 2);
        }
        if (timing === "hidden") {
          panel.visible = false;
          controller.handlePanelHidden();
        }
        current = {
          ...prior,
          queueId: timing.includes("recycled before ready") ? 18 : 17,
          building: false
        };
        tail = timing.includes("recycled before ready") ? "replacement result" : finished;
        finishPoll();
        await vi.advanceTimersByTimeAsync(0);
        if (recreatedDuringPoll) {
          const model = render.mock.lastCall?.[0];
          assert.ok(model);
          if (failTerminalTail) {
            const failed = reduceConsoleMessages(
              model,
              posted.mock.calls.map(([m]) => m)
            );
            assert.equal(failed.consoleError, "terminal read unavailable");
            assert.equal(failed.consoleHtmlModel?.text ?? failed.consoleText, "first lines");
            failTerminalTail = false;
            controller.handlePanelHidden();
            await controller.handlePanelVisible();
          }
          const recovered = reduceConsoleMessages(
            model,
            posted.mock.calls.map(([m]) => m)
          );
          assert.equal(recovered.consoleError, undefined);
          assert.equal(recovered.consoleHtmlModel?.text ?? recovered.consoleText, finished);
          assert.equal(controller.getDiagnosticConsoleText(), finished);
          assert.equal(getConsoleTextTail.mock.calls.length, timing.startsWith("failed") ? 4 : 3);
          return;
        }
        if (timing.endsWith("before ready")) {
          // Console messages posted before React attaches its listener would be lost.
          const consoleMessages = () =>
            posted.mock.calls
              .map(([message]) => message)
              .filter((message) =>
                ["setConsole", "setConsoleHtml", "appendConsole", "appendConsoleHtml"].includes(
                  message.type
                )
              );
          assert.deepEqual(consoleMessages(), []);
          const loadToken = render.mock.lastCall?.[0].loadToken;
          assert.ok(loadToken);
          if (timing === "new load before ready") {
            current = { ...current, queueId: 18 };
            tail = "new document log";
            await controller.load(backend as never, environment, url);
            assert.equal(render.mock.lastCall?.[0].consoleText, tail);
            acknowledgeWebview(controller, loadToken);
            await vi.advanceTimersByTimeAsync(0);
            assert.deepEqual(consoleMessages(), []);
            acknowledgeWebview(controller);
            await vi.advanceTimersByTimeAsync(0);
            assert.deepEqual(consoleMessages(), []);
            assert.equal(controller.getDiagnosticConsoleText(), tail);
            return;
          }
          if (timing === "disposed before ready") {
            controller.dispose();
            acknowledgeWebview(controller, loadToken);
            await vi.advanceTimersByTimeAsync(30_000);
            assert.deepEqual(consoleMessages(), []);
            return;
          }
          if (timing === "hidden before ready") {
            panel.visible = false;
            controller.handlePanelHidden();
          }
          acknowledgeWebview(controller, loadToken + 1);
          await vi.advanceTimersByTimeAsync(0);
          assert.deepEqual(consoleMessages(), []);
          acknowledgeWebview(controller, loadToken);
          acknowledgeWebview(controller, loadToken);
          await vi.advanceTimersByTimeAsync(30_000);
          if (failTerminalTail) {
            const sameRun = current.queueId === prior.queueId;
            const fallback = sameRun ? "first lines" : "";
            assert.equal(controller.getDiagnosticConsoleText(), fallback);
            assert.deepEqual(consoleMessages(), [
              sameRun && html
                ? { type: "setConsoleHtml", html: `<pre>${fallback}</pre>`, truncated: false }
                : { type: "setConsole", text: fallback, truncated: false }
            ]);
            assert.ok(
              posted.mock.calls.some(([m]) =>
                m.errors?.includes("Console output: terminal read unavailable")
              )
            );
            const model = render.mock.lastCall?.[0];
            assert.ok(model);
            const failed = reduceConsoleMessages(
              model,
              posted.mock.calls.map(([m]) => m)
            );
            assert.equal(failed.consoleError, "terminal read unavailable");
            assert.equal(failed.consoleHtmlModel?.text ?? failed.consoleText, fallback);
            posted.mockClear();
            failTerminalTail = false;
            controller.handlePanelHidden();
            await controller.handlePanelVisible();
            const recovered = reduceConsoleMessages(
              failed,
              posted.mock.calls.map(([m]) => m)
            );
            assert.equal(recovered.consoleError, undefined);
            assert.equal(recovered.consoleHtmlModel?.text ?? recovered.consoleText, tail);
            assert.ok(
              posted.mock.calls.some(
                ([m]) =>
                  m.type === "setErrors" &&
                  !m.errors.includes("Console output: terminal read unavailable")
              )
            );
          }
          assert.deepEqual(consoleMessages(), [
            html
              ? { type: "setConsoleHtml", html: `<pre>${tail}</pre>`, truncated: false }
              : { type: "setConsole", text: tail, truncated: false }
          ]);
          assert.equal(controller.getDiagnosticConsoleText(), tail);
          if (timing === "before ready") {
            posted.mockClear();
            const reads = getConsoleTextTail.mock.calls.length;
            acknowledgeWebview(controller, loadToken, "second");
            acknowledgeWebview(controller, loadToken, "first");
            acknowledgeWebview(controller, loadToken, "second");
            await vi.advanceTimersByTimeAsync(0);
            assert.equal(getConsoleTextTail.mock.calls.length, reads + 1);
            assert.equal(consoleMessages().length, 1);
            assert.equal(
              html ? consoleMessages()[0]?.html : consoleMessages()[0]?.text,
              html ? `<pre>${tail}</pre>` : tail
            );
            assert.ok(
              posted.mock.calls.some(
                ([m]) => m.type === "updateDetails" && m.resultClass !== "running"
              )
            );
          }
          return;
        }
        if (timing === "hidden") {
          await vi.advanceTimersByTimeAsync(5000);
          assert.equal(getConsoleTextTail.mock.calls.length, 1);
          panel.visible = true;
          await controller.handlePanelVisible();
        }
        renderReady();
        await load;
        await finalStarted;
        if (timing === "disposed" || timing === "replaced") {
          if (timing === "disposed") controller.dispose();
          else {
            current = { ...prior, queueId: 18 };
            tail = "replacement log";
            await controller.refreshBuildStatus(controller.getLoadToken());
          }
          posted.mockClear();
          finishTail();
          await vi.advanceTimersByTimeAsync(0);
          assert.ok(
            posted.mock.calls.every(
              ([message]) => message.text !== finished && message.html !== `<pre>${finished}</pre>`
            )
          );
          assert.equal(
            controller.getDiagnosticConsoleText(),
            timing === "replaced" ? "replacement log" : "first lines"
          );
          return;
        }
        assert.equal(controller.getDiagnosticConsoleText(), finished);
        const rendered = render.mock.lastCall?.[0];
        if (timing === "before render") {
          assert.equal(rendered?.consoleText, finished);
          assert.equal(rendered?.consoleHtml, html ? `<pre>${finished}</pre>` : undefined);
        } else {
          assert.ok(
            posted.mock.calls.some(([message]) =>
              html ? message.html === `<pre>${finished}</pre>` : message.text === finished
            )
          );
        }
        await vi.advanceTimersByTimeAsync(30_000);
        assert.deepEqual(
          getConsoleTextTail.mock.calls.map(([, buildUrl]) => buildUrl),
          [url, url]
        );
        if (html)
          assert.deepEqual(
            getConsoleHtmlProgressive.mock.calls.map(([, buildUrl, start]) => [buildUrl, start]),
            [
              [url, 0],
              [url, 0]
            ]
          );
      } finally {
        renderReady();
        finishPoll();
        finishTail();
        controller.dispose();
        render.mockRestore();
        assets.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it.each(["initial", "restored", "navigation", "visible poll", "hidden poll", "refresh"])(
    "detaches a mismatched running alias during %s and preserves its primary follow",
    async (phase) => {
      vi.useFakeTimers();
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const primary = {
        environment,
        buildUrl: `${environment.url}job/app/42/`,
        buildNumber: 42,
        queueId: 17,
        label: "app #42"
      };
      const alias = { ...primary, buildUrl: `${environment.url}plugin/runs/42/` };
      const expected = { number: 42, url: alias.buildUrl, building: true, queueId: 17 };
      const mismatch = { ...expected, number: 43, queueId: 18 };
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn(), getBuildDetails: vi.fn(async () => expected) },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      const getBuildDetails = vi.fn().mockResolvedValue(mismatch);
      const backend = {
        status: { getBuildDetails, getWorkflowRun: vi.fn() },
        pendingInputs: { getPendingInputActions: vi.fn(async () => []) },
        tests: {},
        console: {},
        restart: {},
        coverage: {}
      };
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const panel = { visible: phase !== "hidden poll", webview: { postMessage: vi.fn() } };
      const coverage = { deactivateOwner: vi.fn(), clearCoverageContext: vi.fn() };
      const controller = new BuildDetailsPanelController(
        panel as never,
        {} as never,
        coverage as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        tracker
      );
      try {
        tracker.follow(primary);
        tracker.observeRunningBuild(alias, true);
        assert.equal(tracker.isFollowingBuild(environment, alias.buildUrl), true);
        if (["visible poll", "hidden poll", "refresh"].includes(phase))
          getBuildDetails.mockResolvedValueOnce(expected);
        await controller.load(backend as never, environment, alias.buildUrl, {
          initialDetails: phase === "navigation" ? mismatch : undefined,
          panelState:
            phase === "restored" ? { ...environment, buildUrl: alias.buildUrl } : undefined
        });
        if (phase === "visible poll" || phase === "hidden poll") {
          assert.equal(tracker.isFollowingBuild(environment, alias.buildUrl), true);
          await vi.advanceTimersByTimeAsync(5000);
        } else if (phase === "refresh") {
          await controller.refreshBuildStatus(controller.getLoadToken());
        }
        assert.equal(tracker.isFollowingBuild(environment, alias.buildUrl), false);
        assert.equal(tracker.isFollowingBuild(environment, primary.buildUrl), true);
        assert.equal(tracker.isFollowingQueueItem(environment, 17), true);
        assert.equal(tracker.count, 1);
      } finally {
        controller.dispose();
        tracker.dispose();
        assets.mockRestore();
        render.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it("renders a followed action's verified initial Run before visibility can substitute another build", async () => {
    const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
    const url = `${environment.url}job/app/42/`;
    const selected = { number: 42, url, queueId: 17, displayName: "original", building: true };
    const getBuildDetails = vi.fn(async () => ({
      ...selected,
      queueId: 18,
      displayName: "replacement"
    }));
    const backend = {
      status: { getBuildDetails, getWorkflowRun: vi.fn() },
      pendingInputs: { getPendingInputActions: async () => [] },
      tests: {},
      console: {},
      coverage: {},
      restart: {}
    };
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const assets = vi
      .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
      .mockReturnValue({} as never);
    const render = vi
      .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
      .mockImplementation(() => {});
    const controller = new BuildDetailsPanelController(
      { visible: true, webview: { postMessage: vi.fn() } } as never,
      {} as never,
      { clearCoverageContext: vi.fn(), deactivateOwner: vi.fn() } as never,
      undefined,
      undefined,
      undefined,
      () => gate
    );
    try {
      const loading = controller.load(backend as never, environment, url, {
        initialDetails: selected,
        verifiedSelection: true
      });
      controller.handlePanelHidden();
      await controller.handlePanelVisible();
      await controller.refreshBuildStatus(controller.getLoadToken());
      resume();
      await loading;
      assert.equal(getBuildDetails.mock.calls.length, 0);
      assert.equal(controller.getCurrentDetails()?.queueId, 17);
      assert.equal(render.mock.lastCall?.[0].queueId, 17);
    } finally {
      resume();
      controller.dispose();
      assets.mockRestore();
      render.mockRestore();
    }
  });

  it.each([
    ...["load", "refresh"].flatMap((phase) =>
      [
        "queued",
        "direct",
        "unbound",
        "unfollowed",
        "other queue",
        "stopped",
        "anonymous result"
      ].map((subscription) => ({ phase, subscription }))
    ),
    ...["held load", "held supplied"].flatMap((phase) =>
      ["queued", "unfollowed", "stopped"].map((subscription) => ({ phase, subscription }))
    ),
    ...["held running", "held partial"].map((phase) => ({ phase, subscription: "queued" })),
    ...["disposed before receipt", "navigated before receipt", "stopped before receipt"].map(
      (phase) => ({ phase, subscription: "queued" })
    )
  ])(
    "routes a first panel Run on $phase to its exact subscription ($subscription)",
    async ({ phase, subscription }) => {
      vi.useFakeTimers();
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const url = new URL("job/app/42/", environment.url).href;
      const terminal = {
        url,
        number: 42,
        queueId: subscription === "anonymous result" ? undefined : 17,
        building: false,
        result: "SUCCESS"
      };
      const getBuildDetails = vi.fn().mockResolvedValue(terminal);
      if (phase === "refresh") getBuildDetails.mockResolvedValueOnce({ url, number: 42 });
      const held = phase.startsWith("held");
      const executable = phase === "held running" || phase === "held partial";
      if (executable)
        getBuildDetails.mockResolvedValueOnce({
          ...terminal,
          building: phase === "held running" ? true : undefined,
          result: undefined
        });
      const stale = phase.endsWith("before receipt");
      let releaseAncillary!: () => void;
      const ancillary = new Promise<void>((resolve) => {
        releaseAncillary = resolve;
      });
      let deliverStatus!: (details: JenkinsBuildDetails) => void;
      if (stale)
        getBuildDetails.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              deliverStatus = resolve;
            })
        );
      const backend = {
        status: { getBuildDetails, getWorkflowRun: vi.fn() },
        pendingInputs: {
          getPendingInputActions: async () => {
            if (held) await ancillary;
            return [];
          }
        },
        console: {},
        tests: {},
        coverage: {},
        restart: {}
      };
      let finishExecutable!: () => void;
      const independentStatus = new Promise<void>((resolve) => {
        finishExecutable = resolve;
      });
      let expire: (() => void) | undefined;
      const tracker = new BuildCompletionTracker(
        {
          getQueueItem: () =>
            new Promise((_, reject) => {
              expire = () => reject(new JenkinsRequestError("queue item expired", 404));
            }),
          getBuildDetails: vi.fn(async () => {
            if (executable) await independentStatus;
            return terminal;
          })
        },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const controller = new BuildDetailsPanelController(
        { visible: false, webview: { postMessage: vi.fn() } } as never,
        {} as never,
        {
          activateOwner: vi.fn(),
          deactivateOwner: vi.fn(),
          clearCoverageContext: vi.fn()
        } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        tracker
      );
      const discovery =
        subscription === "queued"
          ? tracker.beginSubmittedQueueDiscovery(environment, 17)
          : undefined;
      const located = vi.fn();
      void discovery?.observations?.whenIdentified.then(located);
      const notices = vi.fn();
      tracker.onDidNotifyCompletion(notices);
      try {
        if (["queued", "other queue", "stopped", "anonymous result"].includes(subscription)) {
          tracker.followQueueItem({
            environment,
            label: "app",
            queueId: subscription === "other queue" ? 18 : 17
          });
          await vi.advanceTimersByTimeAsync(0);
          if (subscription === "stopped") tracker.stopFollowingQueueItem(environment, 17);
        } else if (subscription === "direct" || subscription === "unbound") {
          tracker.follow({
            environment,
            buildUrl: url,
            buildNumber: 42,
            queueId: subscription === "direct" ? 17 : undefined,
            label: "app #42"
          });
        }
        resolveInformationMessage = undefined;
        const claim = vi.spyOn(tracker, "claimPanelCompletion");
        const loading = controller.load(
          backend as never,
          environment,
          url,
          phase === "held supplied" ? { initialDetails: terminal } : undefined
        );
        if (held) {
          await vi.advanceTimersByTimeAsync(0);
          assert.equal(render.mock.calls.length, 0);
          assert.equal(controller.getCurrentDetails(), undefined);
          expire?.();
          await vi.advanceTimersByTimeAsync(0);
          if (executable) {
            assert.equal(tracker.isFollowingBuild(environment, url), true);
            assert.equal(claim.mock.calls.length, 0);
            assert.equal(notices.mock.calls.length, 0);
            finishExecutable();
            await vi.advanceTimersByTimeAsync(10_000);
            assert.deepEqual(
              notices.mock.calls.map(([notice]) => [notice.buildUrl, notice.result]),
              [[url, "SUCCESS"]]
            );
            releaseAncillary();
            await loading;
            return;
          }
          assert.equal(notices.mock.calls.length, Number(subscription === "queued"));
          assert.equal(Boolean(resolveInformationMessage), subscription === "queued");
          assert.equal(claim.mock.calls.length, 1);
          releaseAncillary();
        }
        if (stale) {
          if (phase.startsWith("disposed")) controller.dispose();
          else if (phase.startsWith("navigated"))
            await controller.load(backend as never, environment, url, {
              initialDetails: { ...terminal, queueId: 18 }
            });
          else tracker.stopFollowingQueueItem(environment, 17);
          deliverStatus(terminal);
          await loading;
          expire?.();
          await vi.advanceTimersByTimeAsync(0);
          assert.equal(notices.mock.calls.length, 0);
          assert.equal(Boolean(resolveInformationMessage), false);
          return;
        }
        await loading;
        if (held) assert.equal(claim.mock.calls.length, 1);
        if (phase === "refresh") await controller.refreshBuildStatus(controller.getLoadToken());
        const matched = subscription === "queued" || subscription === "direct";
        assert.equal(
          tracker.count,
          Number(["unbound", "other queue", "anonymous result"].includes(subscription))
        );
        assert.equal(notices.mock.calls.length, Number(matched));
        if (discovery) {
          assert.equal(located.mock.lastCall?.[0]?.kind, "started");
          assert.equal(located.mock.lastCall?.[0]?.build.buildUrl, url);
          discovery.finish();
        }
        assert.equal(Boolean(resolveInformationMessage), matched);
        (resolveInformationMessage as ((selection: undefined) => void) | undefined)?.(undefined);
        expire?.();
        await vi.advanceTimersByTimeAsync(subscription === "unbound" ? 10_000 : 0);
        assert.deepEqual(
          notices.mock.calls.map(([notice]) => [notice.queueId, notice.result]),
          matched || subscription === "unbound" ? [[17, "SUCCESS"]] : []
        );
        (resolveInformationMessage as ((selection: undefined) => void) | undefined)?.(undefined);
      } finally {
        discovery?.finish();
        controller.dispose();
        tracker.dispose();
        assets.mockRestore();
        render.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it.each([
    ["visible", "running"],
    ["confirmed during workflow", "running"],
    ["replaced during workflow", "running"],
    ["hidden", "running"],
    ["manual", "running"],
    ["visible", "unknown"],
    ["hidden", "unknown"],
    ["manual", "unknown"],
    ["initial", "completed"],
    ["retry tests", "unknown"],
    ["retry coverage", "unknown"],
    ["retry modified files", "unknown"],
    ["retry workflow", "unknown"],
    ["retry workflow on reveal", "unknown"]
  ])(
    "loads terminal reports once on the %s path after %s status and notifies only for a running transition",
    async (phase, initial) => {
      vi.useFakeTimers();
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const url = `${environment.url}job/app/42/`;
      const running = { number: 42, url, queueId: 17, building: true };
      const partial = { number: 42, url };
      const terminal = { ...running, building: false, result: "SUCCESS" };
      const getBuildDetails = vi
        .fn()
        .mockResolvedValueOnce(
          initial === "completed" ? terminal : initial === "running" ? running : partial
        )
        .mockResolvedValueOnce(partial)
        .mockResolvedValue(terminal);
      const report = { totalCount: 5, passCount: 5 };
      const getTestReport = vi.fn(async () => report);
      let release: ((value: typeof report) => void) | undefined;
      if (phase === "hidden") {
        getTestReport.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve;
            })
        );
      }
      const getCoverageOverview = vi.fn(async () => ({ projectCoverage: "81%", qualityGates: [] }));
      if (phase === "retry tests")
        getTestReport.mockRejectedValueOnce(new Error("transient report failure"));
      if (phase === "retry coverage")
        getCoverageOverview.mockRejectedValueOnce(new Error("transient coverage failure"));
      const getModifiedCoverageFiles = vi.fn(async () => []);
      if (phase === "retry modified files")
        getModifiedCoverageFiles.mockRejectedValueOnce(new Error("modified files unavailable"));
      const getWorkflowRun = vi
        .fn()
        .mockResolvedValueOnce({ stages: [{ name: "Partial stage", status: "IN_PROGRESS" }] });
      let finishWorkflow: (() => void) | undefined;
      const concurrentRefresh = phase.endsWith("during workflow");
      if (concurrentRefresh)
        getWorkflowRun.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishWorkflow = () =>
                resolve({ stages: [{ name: "Final stage", status: "SUCCESS" }] });
            })
        );
      if (phase.startsWith("retry workflow"))
        getWorkflowRun.mockRejectedValueOnce(new Error("workflow unavailable"));
      getWorkflowRun.mockResolvedValue({ stages: [{ name: "Final stage", status: "SUCCESS" }] });
      const backend = {
        status: { getBuildDetails, getWorkflowRun },
        pendingInputs: { getPendingInputActions: vi.fn(async () => []) },
        tests: { getTestReport },
        console: {},
        restart: {},
        coverage: {
          discoverCoverageActionPath: vi.fn(async () => "coverage"),
          getCoverageOverview,
          getModifiedCoverageFiles
        }
      };
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const tracker = {
        onDidNotifyCompletion: vi.fn(),
        observeBuildIdentity: vi.fn(),
        observeRunningBuild: vi.fn(),
        rejectMismatchedBuild: vi.fn(),
        claimPanelCompletion: vi.fn().mockResolvedValue({
          disposition: phase === "confirmed during workflow" ? "panel" : "tracker"
        }),
        recordPanelCompletion: vi.fn()
      };
      const transitionClaims = () =>
        tracker.claimPanelCompletion.mock.calls.filter(([request]) => !request.subscribersOnly);
      const changed = vi.fn();
      const initiallyHidden = phase === "hidden" || phase === "retry workflow on reveal";
      const panel = { visible: !initiallyHidden, webview: { postMessage: vi.fn() } };
      const controller = new BuildDetailsPanelController(
        panel as never,
        {} as never,
        {
          activateOwner: vi.fn(),
          deactivateOwner: vi.fn(),
          clearCoverageContext: vi.fn()
        } as never,
        undefined,
        changed,
        undefined,
        undefined,
        undefined,
        tracker
      );
      const next = async () => {
        if (phase === "manual") await controller.refreshBuildStatus(controller.getLoadToken());
        else await vi.advanceTimersToNextTimerAsync();
      };
      try {
        await controller.load(backend as never, environment, url);
        if (initial !== "completed") {
          await next();
          assert.equal(changed.mock.lastCall?.[0]?.building, undefined);
          assert.equal(
            controller.getCurrentDetails()?.building,
            initial === "running" ? true : undefined
          );
          assert.equal(
            controller.getRunningFollowTarget()?.queueId,
            initial === "running" ? 17 : undefined
          );
          assert.equal(transitionClaims().length, 0);
          assert.equal(getTestReport.mock.calls.length, 0);
          assert.equal(getCoverageOverview.mock.calls.length, 0);
          await next();
          if (concurrentRefresh) {
            assert.ok(finishWorkflow);
            assert.equal(transitionClaims().length, 0);
            const replaced = phase === "replaced during workflow";
            if (replaced) {
              getBuildDetails.mockResolvedValue({ ...terminal, queueId: 18 });
              getWorkflowRun.mockResolvedValue({
                stages: [{ name: "Replacement stage", status: "SUCCESS" }]
              });
            }
            await controller.refreshBuildStatus(controller.getLoadToken());
            finishWorkflow();
            await vi.advanceTimersByTimeAsync(0);
            const stages = panel.webview.postMessage.mock.calls
              .filter(([message]) => message.type === "updateDetails")
              .map(([message]) => message.pipelineStages?.[0]?.name);
            assert.equal(stages.at(-1), replaced ? "Replacement stage" : "Final stage");
            assert.equal(getWorkflowRun.mock.calls.length, replaced ? 3 : 2);
            if (replaced) {
              assert.equal(controller.getCurrentDetails()?.queueId, 18);
              assert.ok(!stages.includes("Final stage"));
              return;
            }
            assert.equal(tracker.recordPanelCompletion.mock.calls.length, 1);
            resolveInformationMessage?.(undefined);
          }
        } else {
          getBuildDetails.mockReset().mockResolvedValue(terminal);
        }
        assert.equal(controller.getCurrentDetails()?.building, false);
        assert.equal(controller.getRunningFollowTarget(), undefined);
        assert.equal(transitionClaims().length, initial === "running" ? 1 : 0);
        assert.equal(getTestReport.mock.calls.length, 1);

        if (phase === "retry workflow") await vi.advanceTimersByTimeAsync(15000);
        if (!initiallyHidden && initial !== "completed") {
          assert.ok(
            panel.webview.postMessage.mock.calls.some(
              ([message]) => message.pipelineStages?.[0]?.name === "Final stage"
            )
          );
        }
        if (phase === "retry modified files") {
          assert.ok(
            panel.webview.postMessage.mock.calls.some(
              ([message]) => message.coverageState?.projectCoverage === "81%"
            )
          );
        }
        panel.visible = true;
        const shown = controller.handlePanelVisible();
        release?.(report);
        await shown;
        if (phase === "retry workflow on reveal") {
          await vi.advanceTimersByTimeAsync(15000);
          assert.ok(
            panel.webview.postMessage.mock.calls.some(
              ([message]) => message.pipelineStages?.[0]?.name === "Final stage"
            )
          );
        }
        await controller.handlePanelVisible();
        assert.equal(getTestReport.mock.calls.length, phase === "retry tests" ? 2 : 1);
        const coverageAttempts =
          phase === "retry coverage" || phase === "retry modified files" ? 2 : 1;
        assert.equal(getCoverageOverview.mock.calls.length, coverageAttempts);
        assert.equal(getModifiedCoverageFiles.mock.calls.length, coverageAttempts);
        const updates = panel.webview.postMessage.mock.calls.map(([message]) => message);
        assert.ok(updates.some((message) => message.pipelineStages?.[0]?.name === "Final stage"));
        assert.ok(
          updates.some(
            (message) =>
              message.type === "updateDetails" && message.testState.summary.totalCount === 5
          )
        );
        assert.ok(
          updates.some(
            (message) =>
              message.type === "updateDetails" && message.coverageState.projectCoverage === "81%"
          )
        );
      } finally {
        controller.dispose();
        render.mockRestore();
        assets.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it("updates only the terminal test report when its log setting changes, including a hidden mid-request change", async () => {
    const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
    const url = `${environment.url}job/app/42/`;
    const details = { number: 42, url, building: false, result: "SUCCESS" };
    const report = { totalCount: 5, passCount: 5 };
    const getTestReport = vi.fn(
      async (_env: unknown, _url: string, _options?: { includeCaseLogs?: boolean }) => report
    );
    const discoverCoverageActionPath = vi.fn(async () => undefined);
    const backend = {
      status: { getBuildDetails: async () => details, getWorkflowRun: vi.fn() },
      pendingInputs: { getPendingInputActions: async () => [] },
      tests: { getTestReport },
      console: {},
      restart: {},
      coverage: { discoverCoverageActionPath }
    };
    const assets = vi
      .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
      .mockReturnValue({} as never);
    const render = vi
      .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
      .mockImplementation(() => {});
    const panel = { visible: true, webview: { postMessage: vi.fn() } };
    const controller = new BuildDetailsPanelController(
      panel as never,
      {} as never,
      {
        activateOwner: vi.fn(),
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never
    );
    try {
      await controller.load(backend as never, environment, url);
      let release!: (value: typeof report) => void;
      getTestReport.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      configuredCaseLogs = true;
      controller.updateTestReportOptions();
      assert.equal(getTestReport.mock.calls.length, 2);
      panel.visible = false;
      controller.handlePanelHidden();
      configuredCaseLogs = false;
      controller.updateTestReportOptions();
      assert.equal(getTestReport.mock.calls.length, 2);
      release({ totalCount: 77, passCount: 77 });
      await Promise.resolve();
      panel.visible = true;
      await controller.handlePanelVisible();
      await controller.handlePanelVisible();
      assert.deepEqual(
        getTestReport.mock.calls.map(([, , options]) => options?.includeCaseLogs),
        [false, true, false]
      );
      assert.equal(discoverCoverageActionPath.mock.calls.length, 1);
      assert.ok(
        !panel.webview.postMessage.mock.calls.some(
          ([message]) => message.testState?.summary.totalCount === 77
        )
      );
    } finally {
      configuredCaseLogs = false;
      controller.dispose();
      render.mockRestore();
      assets.mockRestore();
    }
  });

  it.each([
    ["initial", "job/app/lastBuild/", "job/app/42/", 42, "job/app/43/", 43],
    ["poll", "job/app/lastBuild/", "job/app/42/", 42, "job/app/43/", 43],
    ["initial", "job/app/lastBuild/", "job/app/custom-runs/42/", 42, "job/app/other-runs/42/", 42],
    ["poll", "job/app/lastBuild/", "job/app/custom-runs/42/", 42, "job/app/other-runs/42/", 42],
    ["initial", "job/app/0/?tab=stages", "job/app/0/", 0, "job/app/0/", 0],
    ["poll", "job/app/42/", "job/app/42/", 42, "job/app/42/", 42],
    ["manual", "job/app/lastBuild/", "job/app/42/", 42, "job/app/43/", 43],
    [
      "visibility",
      "job/app/lastBuild/",
      "job/app/custom-runs/42/",
      42,
      "job/app/other-runs/42/",
      42
    ]
  ] as const)(
    "pins a running workflow during %s on %s and invalidates it when the displayed Run changes",
    async (phase, selector, oldPath, oldNumber, nextPath, nextNumber) => {
      vi.useFakeTimers();
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const panelUrl = environment.url + selector;
      const oldUrl = environment.url + oldPath;
      const nextUrl = environment.url + nextPath;
      const refresh = phase === "manual" || phase === "visibility";
      let current = {
        number: oldNumber as number,
        url: oldUrl,
        queueId: refresh ? 16 : 17,
        building: true
      };
      const getBuildDetails = vi.fn(async () => ({ ...current }));
      let hold = phase === "initial";
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let queried!: () => void;
      const pending = new Promise<void>((resolve) => {
        queried = resolve;
      });
      const getWorkflowRun = vi.fn(
        async (_env: unknown, requested: string, run: { queueId?: number }) => {
          if (requested === panelUrl && panelUrl !== oldUrl && panelUrl !== nextUrl)
            return { stages: [{ name: "selector has already advanced" }] };
          if (hold && run.queueId === 17) {
            queried();
            await gate;
            return { stages: [{ name: "retired workflow" }] };
          }
          return { stages: [{ name: run.queueId === 18 ? "replacement" : "original" }] };
        }
      );
      const backend = {
        status: { getBuildDetails, getWorkflowRun },
        console: {},
        coverage: {},
        tests: {},
        restart: {},
        pendingInputs: { getPendingInputActions: async () => [] }
      };
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const posted = vi.fn();
      const controller = new BuildDetailsPanelController(
        { visible: true, webview: { postMessage: posted } } as never,
        {} as never,
        { clearCoverageContext: vi.fn(), deactivateOwner: vi.fn(), activateOwner: vi.fn() } as never
      );
      try {
        const loading = controller.load(backend as never, environment, panelUrl);
        let pendingRefresh: Promise<void> | undefined;
        if (phase !== "initial") {
          await loading;
          assert.equal(render.mock.lastCall?.[0].pipelineStages[0]?.name, "original");
          hold = true;
          if (refresh) {
            current = { ...current, queueId: 17 };
            pendingRefresh =
              phase === "manual"
                ? controller.refreshBuildStatus(controller.getLoadToken())
                : controller.handlePanelVisible();
          } else await vi.advanceTimersByTimeAsync(15000);
        }
        await pending;
        assert.equal(getWorkflowRun.mock.lastCall?.[1], oldUrl);
        current = { number: nextNumber, url: nextUrl, queueId: 18, building: true };
        await controller.refreshBuildStatus(controller.getLoadToken());
        assert.equal(getWorkflowRun.mock.lastCall?.[1], nextUrl);
        release();
        await Promise.all([loading, pendingRefresh]);
        await vi.advanceTimersByTimeAsync(0);
        assert.equal(controller.getCurrentDetails()?.queueId, 18);
        assert.ok(
          getWorkflowRun.mock.calls.every(
            ([, requested, run]) => requested === (run.queueId === 18 ? nextUrl : oldUrl)
          )
        );
        const stageUpdates = posted.mock.calls
          .filter(([message]) => message.type === "updateDetails")
          .map(([message]) => message.pipelineStages?.[0]?.name);
        assert.ok(!stageUpdates.includes("retired workflow"));
        assert.equal(stageUpdates.at(-1), "replacement");
        if (phase === "initial")
          assert.equal(render.mock.lastCall?.[0].pipelineStages[0]?.name, "replacement");
      } finally {
        release();
        controller.dispose();
        render.mockRestore();
        assets.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it.each([
    ["job/app/lastBuild/", "job/app/42/", 42, "job/app/43/", 43],
    ["job/app/lastBuild/", "job/app/custom-runs/42/", 42, "job/app/other-runs/42/", 42],
    ["job/app/0?tab=tests", "job/app/0/", 0, "job/app/0/", 0]
  ] as const)(
    "pins terminal requests from %s to %s and discards superseded responses",
    async (panelPath, oldPath, oldNumber, newPath, newNumber) => {
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const initialUrl = environment.url + oldPath;
      const nextUrl = environment.url + newPath;
      const terminal = {
        number: oldNumber,
        url: initialUrl,
        queueId: 17,
        building: false,
        result: "FAILURE"
      };
      let current: JenkinsBuildDetails = terminal;
      let delay = false;
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const getTestReport = vi.fn(async (_env: unknown, _url: string) => {
        if (delay) {
          await gate;
          return { totalCount: 99 };
        }
        return { totalCount: current.queueId };
      });
      const getCoverageOverview = vi.fn(async (_env: unknown, _url: string) => {
        if (delay) {
          await gate;
          return { projectCoverage: "stale", qualityGates: [] };
        }
        return { projectCoverage: String(current.queueId), qualityGates: [] };
      });
      const getWorkflowRun = vi.fn(
        async (_env: unknown, _url: string, run: { queueId?: number }) => {
          if (delay && run.queueId === 17) {
            await gate;
            return { stages: [{ name: "stale" }] };
          }
          return { stages: [{ name: String(current.queueId) }] };
        }
      );
      const getRestartFromStageInfo = vi.fn(async (_env: unknown, _url: string) => {
        const id = current.queueId;
        if (id === 17) await gate;
        return { availability: "supported", restartEnabled: true, restartableStages: [String(id)] };
      });
      const discoverCoverageActionPath = vi.fn(async (_env: unknown, _url: string) => "coverage");
      const getModifiedCoverageFiles = vi.fn(async (_env: unknown, _url: string) => [
        { path: "app.ts", blocks: [{ startLine: 1, endLine: 2, type: "covered" }] }
      ]);
      const backend = {
        status: { getBuildDetails: async () => current, getWorkflowRun },
        restart: { getRestartFromStageInfo },
        pendingInputs: { getPendingInputActions: async () => [] },
        tests: { getTestReport },
        console: {},
        coverage: { discoverCoverageActionPath, getCoverageOverview, getModifiedCoverageFiles }
      };
      const postMessage = vi.fn();
      const assets = vi
        .spyOn(BuildDetailsPanelView.prototype, "resolveAssetsAndRenderLoading")
        .mockReturnValue({} as never);
      const render = vi
        .spyOn(BuildDetailsPanelView.prototype, "renderBuildDetails")
        .mockImplementation(() => {});
      const setCoverageContext = vi.fn();
      const controller = new BuildDetailsPanelController(
        { visible: true, webview: { postMessage } } as never,
        {} as never,
        {
          activateOwner: vi.fn(),
          deactivateOwner: vi.fn(),
          clearCoverageContext: vi.fn(),
          setCoverageContext
        } as never
      );
      try {
        await controller.load(backend as never, environment, environment.url + panelPath);
        const requests = [
          getTestReport,
          discoverCoverageActionPath,
          getCoverageOverview,
          getModifiedCoverageFiles,
          getWorkflowRun,
          getRestartFromStageInfo
        ];
        for (const read of requests) assert.equal(read.mock.calls[0][1], initialUrl);
        assert.equal(setCoverageContext.mock.lastCall?.[1].buildUrl, initialUrl);
        const token = controller.getLoadToken();
        delay = true;
        const oldTests = controller.refreshTestReport(token, { includeCaseLogs: true });
        const oldCoverage = controller.refreshCoverage(token);
        const oldVisibility = controller.handlePanelVisible();
        await vi.waitFor(() => assert.equal(getWorkflowRun.mock.calls.length, 2));
        assert.equal(getTestReport.mock.lastCall?.[1], initialUrl);
        assert.equal(getCoverageOverview.mock.lastCall?.[1], initialUrl);
        assert.equal(getWorkflowRun.mock.lastCall?.[1], initialUrl);

        current = { number: newNumber, url: nextUrl, queueId: 18, building: true };
        await controller.refreshBuildStatus(token);
        postMessage.mockClear();
        delay = false;
        resume();
        await Promise.all([oldTests, oldCoverage, oldVisibility]);
        assert.deepEqual(controller.getPipelineRestartableStages(), []);
        assert.equal(getModifiedCoverageFiles.mock.calls.length, 1);
        current = { ...current, building: false, result: "FAILURE" };
        await controller.refreshBuildStatus(token);
        await vi.waitFor(() => assert.equal(setCoverageContext.mock.calls.length, 2));
        for (const read of requests) assert.equal(read.mock.lastCall?.[1], nextUrl);
        const updates = postMessage.mock.calls.map(([message]) => message);
        assert.ok(
          updates.every(
            (message) =>
              message.testState?.summary.totalCount !== 99 &&
              message.coverageState?.projectCoverage !== "stale" &&
              message.pipelineStages?.[0]?.name !== "stale"
          )
        );
        assert.ok(
          updates.some(
            (message) =>
              message.testState?.summary.totalCount === 18 &&
              message.coverageState?.projectCoverage === "18"
          )
        );
        assert.deepEqual(controller.getPipelineRestartableStages(), ["18"]);
      } finally {
        resume();
        controller.dispose();
        render.mockRestore();
        assets.mockRestore();
      }
    }
  );

  it.each(["queue ID", "run number", "panel load"])(
    "does not inherit running across a changed %s with incomplete status",
    (change) => {
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const first = { number: 42, queueId: 17, url: `${environment.url}job/app/42/` };
      const selector = `${environment.url}job/app/lastBuild/`;
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, selector, "first");
      state.updateDetails({ ...first, building: true });
      if (change === "panel load") state.resetForLoad(environment, selector, "next");
      const next =
        change === "run number"
          ? { number: 43, url: `${environment.url}job/app/43/` }
          : change === "queue ID"
            ? { ...first, queueId: 18 }
            : first;
      assert.equal(state.updateDetails(next).completedNow, false);
      assert.equal(state.currentDetails?.building, undefined);
      assert.equal(state.getRunningFollowTarget(), undefined);
      assert.equal(state.updateDetails({ ...next, building: false }).completedNow, false);
    }
  );

  it("requests causes on initial recovery and keeps later status refreshes lightweight", async () => {
    const environment = {
      environmentId: "env-1",
      scope: "global" as const,
      url: "https://jenkins.example/"
    };
    const buildUrl = `${environment.url}job/example/1/`;
    const state = new BuildDetailsPanelState();
    state.resetForLoad(environment, buildUrl, "nonce");
    const recovered = {
      number: 1,
      url: buildUrl,
      building: false,
      actions: [{ causes: [{ upstreamUrl: "job/parent/", upstreamBuild: 2 }] }]
    };
    const getBuildDetails = vi.fn().mockResolvedValue(recovered);
    const changed = vi.fn();
    const runtime = new BuildDetailsPanelRuntime({
      state,
      view: { isVisible: () => false } as never,
      coverageDecorationService: {
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never,
      getBackend: () => ({ status: { getBuildDetails } }) as never,
      getPollingController: () => undefined,
      getCurrentToken: () => 1,
      isTokenCurrent: () => true,
      onBuildDetailsChanged: changed
    });
    try {
      await runtime.refreshBuildStatus(1);
      assert.deepEqual(getBuildDetails.mock.calls[0], [
        environment,
        buildUrl,
        { includeCauses: true }
      ]);
      assert.deepEqual(changed.mock.calls[0][0], recovered);
      await runtime.refreshBuildStatus(1);
      assert.equal(getBuildDetails.mock.calls[1][2], undefined);
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the newest test report when concurrent refreshes complete out of order", async () => {
    const buildUrl = "https://jenkins.example/job/example/1/";
    const state = new BuildDetailsPanelState();
    state.resetForLoad(
      { environmentId: "env-1", scope: "global", url: "https://jenkins.example/" },
      buildUrl,
      "nonce"
    );
    state.updateDetails({ number: 1, url: buildUrl, building: false });

    const requests: Array<{
      resolve: (value: {
        report: { totalCount: number };
        effectiveOptions: { includeCaseLogs: boolean };
      }) => void;
    }> = [];
    const pollingController = {
      fetchTestReport: () =>
        new Promise((resolve) => {
          requests.push({ resolve });
        })
    };
    const runtime = new BuildDetailsPanelRuntime({
      state,
      view: { isVisible: () => true, postStateUpdate: vi.fn() } as never,
      coverageDecorationService: {
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never,
      getBackend: () => undefined,
      getPollingController: () => pollingController as never,
      getCurrentToken: () => 1,
      isTokenCurrent: () => true
    });

    const olderRefresh = runtime.refreshTestReport(1, {
      includeCaseLogs: false,
      showLoading: true
    });
    const newerRefresh = runtime.refreshTestReport(1, {
      includeCaseLogs: true,
      showLoading: true
    });
    requests[1].resolve({ report: { totalCount: 2 }, effectiveOptions: { includeCaseLogs: true } });
    await newerRefresh;
    requests[0].resolve({
      report: { totalCount: 1 },
      effectiveOptions: { includeCaseLogs: false }
    });
    await olderRefresh;

    assert.equal(state.currentTestReport?.totalCount, 2);
    assert.equal(state.testReportLogsIncluded, true);
    assert.equal(state.testResultsLoading, false);
  });

  it("clears loading when a newer refresh without showLoading fails after a showLoading refresh", async () => {
    const buildUrl = "https://jenkins.example/job/example/1/";
    const state = new BuildDetailsPanelState();
    state.resetForLoad(
      { environmentId: "env-1", scope: "global", url: "https://jenkins.example/" },
      buildUrl,
      "nonce"
    );
    state.updateDetails({ number: 1, url: buildUrl, building: false });

    const requests: Array<{
      resolve: (value: {
        report: { totalCount: number };
        effectiveOptions: { includeCaseLogs: boolean };
      }) => void;
      reject: (reason: unknown) => void;
    }> = [];
    const pollingController = {
      fetchTestReport: () =>
        new Promise((resolve, reject) => {
          requests.push({ resolve, reject });
        })
    };
    const postStateUpdate = vi.fn();
    const runtime = new BuildDetailsPanelRuntime({
      state,
      view: { isVisible: () => true, postStateUpdate } as never,
      coverageDecorationService: {
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never,
      getBackend: () => undefined,
      getPollingController: () => pollingController as never,
      getCurrentToken: () => 1,
      isTokenCurrent: () => true
    });

    const olderRefresh = runtime.refreshTestReport(1, {
      includeCaseLogs: false,
      showLoading: true
    });
    assert.equal(state.testResultsLoading, true);
    const newerRefresh = runtime.refreshTestReport(1, { includeCaseLogs: true });
    requests[1].reject(new Error("boom"));
    await newerRefresh;

    assert.equal(state.testResultsLoading, false);
    assert.equal(state.testReportFetched, true);
    assert.ok(postStateUpdate.mock.calls.length >= 2);

    requests[0].resolve({
      report: { totalCount: 1 },
      effectiveOptions: { includeCaseLogs: false }
    });
    await olderRefresh;

    assert.equal(state.testResultsLoading, false);
    assert.equal(state.currentTestReport, undefined);
  });

  it("does not restart visible polling when the panel is hidden during the visibility status refresh", async () => {
    const buildUrl = "https://jenkins.example/job/example/1/";
    const state = new BuildDetailsPanelState();
    state.resetForLoad(
      { environmentId: "env-1", scope: "global", url: "https://jenkins.example/" },
      buildUrl,
      "nonce"
    );
    state.updateDetails({ number: 1, url: buildUrl, building: true });

    let resolveDetails: (details: JenkinsBuildDetails) => void = () => undefined;
    const backend = {
      status: {
        getBuildDetails: () =>
          new Promise<JenkinsBuildDetails>((resolve) => {
            resolveDetails = resolve;
          })
      }
    };
    const pollingController = { start: vi.fn(), stop: vi.fn() };
    let visible = true;
    const runtime = new BuildDetailsPanelRuntime({
      state,
      view: {
        isVisible: () => visible,
        postStateUpdate: vi.fn(),
        setTitle: vi.fn()
      } as never,
      coverageDecorationService: {
        activateOwner: vi.fn(),
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never,
      getBackend: () => backend as never,
      getPollingController: () => pollingController as never,
      getCurrentToken: () => 1,
      isTokenCurrent: () => true
    });

    try {
      const visiblePromise = runtime.handlePanelVisible(1);
      visible = false;
      runtime.handlePanelHidden(1);
      resolveDetails({ number: 1, url: buildUrl, building: true });
      const stillVisible = await visiblePromise;

      assert.equal(stillVisible, false);
      assert.equal(pollingController.start.mock.calls.length, 0);
      assert.equal(pollingController.stop.mock.calls.length, 1);
    } finally {
      runtime.dispose();
    }
  });

  it("does not let an old visibility handler interfere with a reloaded panel's report", async () => {
    const environment = {
      environmentId: "env-1",
      scope: "global" as const,
      url: "https://jenkins.example/"
    };
    const buildUrl = `${environment.url}job/example/1/`;
    const state = new BuildDetailsPanelState();
    state.resetForLoad(environment, buildUrl, "nonce-1");
    state.updateDetails({ number: 1, url: buildUrl, building: true });

    let resolveDetails: (details: JenkinsBuildDetails) => void = () => undefined;
    let resolveReport: (value: { report: { totalCount: number } }) => void = () => undefined;
    const backend = {
      status: {
        getBuildDetails: () =>
          new Promise<JenkinsBuildDetails>((resolve) => {
            resolveDetails = resolve;
          })
      }
    };
    const oldPollingController = { start: vi.fn() };
    const newPollingController = {
      start: vi.fn(),
      fetchTestReport: vi.fn().mockResolvedValue({ report: { totalCount: 99 } }),
      refreshConsoleSnapshot: vi.fn().mockResolvedValue({}),
      fetchWorkflowRunWithCallbacks: vi.fn().mockResolvedValue(undefined),
      refreshPendingInputs: vi.fn().mockResolvedValue(undefined)
    };
    newPollingController.fetchTestReport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReport = resolve;
        })
    );
    let pollingController = oldPollingController;
    let currentToken = 1;
    const runtime = new BuildDetailsPanelRuntime({
      state,
      view: { isVisible: () => true, postStateUpdate: vi.fn() } as never,
      coverageDecorationService: {
        activateOwner: vi.fn(),
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never,
      getBackend: () => backend as never,
      getPollingController: () => pollingController as never,
      getCurrentToken: () => currentToken,
      isTokenCurrent: (token) => token === currentToken
    });

    try {
      const visibilityRefresh = runtime.handlePanelVisible(currentToken);
      currentToken += 1;
      runtime.dispose();
      const nextBuildUrl = `${environment.url}job/example/2/`;
      state.resetForLoad(environment, nextBuildUrl, "nonce-2");
      state.updateDetails({ number: 2, url: nextBuildUrl, building: false });
      pollingController = newPollingController;
      const reportRefresh = runtime.refreshTestReport(currentToken, { showLoading: true });
      assert.equal(state.testResultsLoading, true);

      resolveDetails({ number: 1, url: buildUrl, building: true });
      const stillVisible = await visibilityRefresh;
      resolveReport({ report: { totalCount: 2 } });
      await reportRefresh;

      assert.equal(stillVisible, false);
      assert.equal(newPollingController.start.mock.calls.length, 0);
      assert.equal(newPollingController.fetchTestReport.mock.calls.length, 1);
      assert.equal(newPollingController.refreshConsoleSnapshot.mock.calls.length, 0);
      assert.equal(newPollingController.fetchWorkflowRunWithCallbacks.mock.calls.length, 0);
      assert.equal(newPollingController.refreshPendingInputs.mock.calls.length, 0);
      assert.equal(state.currentTestReport?.totalCount, 2);
      assert.equal(state.testResultsLoading, false);
    } finally {
      runtime.dispose();
    }
  });

  it("rejects stale report refreshes without superseding the current request", async () => {
    const buildUrl = "https://jenkins.example/job/example/2/";
    const state = new BuildDetailsPanelState();
    state.resetForLoad(
      { environmentId: "env-1", scope: "global", url: "https://jenkins.example/" },
      buildUrl,
      "nonce"
    );
    state.updateDetails({ number: 2, url: buildUrl, building: false });

    let resolveReport: (value: { report: { totalCount: number } }) => void = () => undefined;
    const fetchTestReport = vi.fn().mockResolvedValue({ report: { totalCount: 99 } });
    fetchTestReport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReport = resolve;
        })
    );
    const runtime = new BuildDetailsPanelRuntime({
      state,
      view: { isVisible: () => true, postStateUpdate: vi.fn() } as never,
      coverageDecorationService: {
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never,
      getBackend: () => undefined,
      getPollingController: () => ({ fetchTestReport }) as never,
      getCurrentToken: () => 2,
      isTokenCurrent: (token) => token === 2
    });

    try {
      const currentRefresh = runtime.refreshTestReport(2, { showLoading: true });
      await runtime.refreshTestReport(1, { showLoading: true });
      resolveReport({ report: { totalCount: 2 } });
      await currentRefresh;

      assert.equal(fetchTestReport.mock.calls.length, 1);
      assert.equal(state.currentTestReport?.totalCount, 2);
      assert.equal(state.testResultsLoading, false);
    } finally {
      runtime.dispose();
    }
  });

  it("starts visible polling when the panel stays visible through the status refresh", async () => {
    const buildUrl = "https://jenkins.example/job/example/1/";
    const state = new BuildDetailsPanelState();
    state.resetForLoad(
      { environmentId: "env-1", scope: "global", url: "https://jenkins.example/" },
      buildUrl,
      "nonce"
    );
    state.updateDetails({ number: 1, url: buildUrl, building: true });

    const backend = {
      status: {
        getBuildDetails: async (): Promise<JenkinsBuildDetails> => ({
          number: 1,
          url: buildUrl,
          building: true
        })
      }
    };
    const pollingController = { start: vi.fn(), stop: vi.fn() };
    const runtime = new BuildDetailsPanelRuntime({
      state,
      view: {
        isVisible: () => true,
        postStateUpdate: vi.fn(),
        setTitle: vi.fn()
      } as never,
      coverageDecorationService: {
        activateOwner: vi.fn(),
        deactivateOwner: vi.fn(),
        clearCoverageContext: vi.fn()
      } as never,
      getBackend: () => backend as never,
      getPollingController: () => pollingController as never,
      getCurrentToken: () => 1,
      isTokenCurrent: () => true
    });

    try {
      const stillVisible = await runtime.handlePanelVisible(1);

      assert.equal(stillVisible, true);
      assert.equal(pollingController.start.mock.calls.length, 1);
    } finally {
      runtime.dispose();
    }
  });

  it.each([10, 11])(
    "keeps a tracked #%i completion tied to its run when lastBuild advances",
    (tracked) => {
      const environment = {
        environmentId: "env",
        scope: "global" as const,
        url: "https://jenkins.example/"
      };
      const jobUrl = `${environment.url}job/app/`;
      const run = (number: number) => ({ number, url: `${jobUrl}${number}/`, building: true });
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, `${jobUrl}lastBuild/`, "nonce");
      state.updateDetails(run(10));
      state.recordFollowedBuildCompletion({
        environment,
        buildUrl: run(tracked).url,
        buildNumber: tracked,
        label: `app #${tracked}`
      });
      for (const number of [10, 11]) {
        const details = { ...run(number), building: false };
        state.updateDetails(details);
        assert.equal(state.hasCompletionNotice(details), number === tracked);
      }
    }
  );

  it("remembers a completion by queue ID until a lagging permalink displays the run", () => {
    const environment = {
      environmentId: "env",
      scope: "global" as const,
      url: "https://jenkins.example/"
    };
    const job = `${environment.url}job/app/`;
    const state = new BuildDetailsPanelState();
    state.resetForLoad(environment, `${job}lastBuild/`, "nonce");
    state.updateDetails({ number: 10, url: `${job}10/`, queueId: 33, building: true });
    state.recordFollowedBuildCompletion({
      environment,
      buildUrl: `${environment.url}plugin/runs/11/`,
      buildNumber: 11,
      queueId: 41,
      label: "app #11"
    });
    const finished = { number: 11, url: `${job}11/`, queueId: 41, building: false };
    state.updateDetails(finished);
    assert.equal(state.hasCompletionNotice(finished), true);
    assert.equal(state.hasCompletionNotice({ ...finished, queueId: 50 }), false);
  });

  it.each(["old alias first", "replacement first"])(
    "keeps completions distinct when two queue IDs reuse the same numbered URL (%s)",
    (order) => {
      const environment = {
        environmentId: "env",
        scope: "global" as const,
        url: "https://jenkins.example/"
      };
      const url = `${environment.url}job/app/11/`;
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, url, "nonce");
      const replacement = { number: 11, url, queueId: 50, building: true };
      const finished = { ...replacement, building: false, queueId: undefined };
      state.updateDetails(replacement);
      const oldCompletion = () =>
        state.recordFollowedBuildCompletion({
          environment,
          buildUrl: `${environment.url}plugin/runs/11/`,
          aliases: [url],
          buildNumber: 11,
          queueId: 41,
          label: "app #11"
        });
      if (order === "old alias first") oldCompletion();
      assert.equal(state.getRunningFollowTarget()?.queueId, 50);
      state.updateDetails(finished);
      assert.equal(state.hasCompletionNotice(finished), false);
      if (order === "replacement first") oldCompletion();
      assert.equal(state.hasCompletionNotice({ ...finished, queueId: 41 }), true);
    }
  );

  it.each(["before the notice", "after the notice"])(
    "keeps a queue ID supplied %s followable until a matching terminal result",
    (timing) => {
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const url = `${environment.url}job/app/9/`;
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, url, "nonce");
      const running = { number: 9, url, building: true, queueId: 17 };
      if (timing === "before the notice") state.updateDetails(running);
      state.recordFollowedBuildCompletion({
        environment,
        buildUrl: url,
        buildNumber: 9,
        label: "#9",
        result: "FAILURE"
      });
      if (timing === "after the notice") state.updateDetails(running);
      assert.equal(state.getRunningFollowTarget()?.queueId, 17);
      const terminal = { ...running, building: false, result: "FAILURE" };
      assert.equal(state.hasCompletionNotice(terminal), true);
      assert.equal(state.hasCompletionNotice({ ...terminal, queueId: 31 }), false);
    }
  );

  it.each([
    ["after", "FAILURE", true],
    ["before", "FAILURE", false],
    ["before", "SUCCESS", true]
  ] as const)(
    "checks a running read started %s an unidentified tracker notice before delivering %s",
    async (start, result, expectedNotice) => {
      vi.useFakeTimers();
      const environment = { environmentId: "env", scope: "global" as const, url: "https://ci/" };
      const url = `${environment.url}job/app/42/`;
      const target = { environment, buildUrl: url, buildNumber: 42, label: "app #42" };
      const replacement = { number: 42, url, building: true, queueId: 18 };
      const getBuildDetails = vi.fn().mockResolvedValueOnce({
        number: 42,
        url,
        building: false,
        result: "FAILURE"
      });
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn(), getBuildDetails },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, url, "nonce");
      let release!: (details: JenkinsBuildDetails) => void;
      const panelRead = vi.fn(
        () =>
          new Promise<JenkinsBuildDetails>((resolve) => {
            release = resolve;
          })
      );
      const runtime = new BuildDetailsPanelRuntime({
        state,
        completionTracker: tracker,
        getBackend: () => ({ status: { getBuildDetails: panelRead } }) as never,
        view: { isVisible: () => false } as never,
        coverageDecorationService: {
          deactivateOwner: vi.fn(),
          clearCoverageContext: vi.fn()
        } as never,
        getPollingController: () => undefined,
        getCurrentToken: () => 1,
        isTokenCurrent: () => true
      });
      const completed: Array<[number | undefined, string | undefined]> = [];
      tracker.onDidNotifyCompletion((build) => {
        if (build.source === "panel") return;
        state.recordFollowedBuildCompletion(build);
        completed.push([build.queueId, build.result]);
      });
      try {
        tracker.follow(target);
        let panelUpdate = start === "before" ? runtime.refreshBuildStatus(1) : undefined;
        await vi.advanceTimersToNextTimerAsync();
        assert.deepEqual(completed, [[undefined, "FAILURE"]]);
        panelUpdate ??= runtime.refreshBuildStatus(1);
        release(replacement);
        await panelUpdate;
        const next = state.getRunningFollowTarget();
        assert.ok(next);
        assert.equal(next.queueId, 18);
        tracker.followObservedBuild(next);
        const actual = { ...replacement, building: false, result };
        const claim = vi.spyOn(tracker, "claimPanelCompletion");
        await runtime.showCompletionToast(actual);
        assert.equal(claim.mock.calls[0][0].previouslyDelivered, !expectedNotice);
        assert.deepEqual(completed, [
          [undefined, "FAILURE"],
          [18, result]
        ]);
        assert.equal(tracker.count, 0);
      } finally {
        runtime.dispose();
        tracker.dispose();
        vi.useRealTimers();
      }
    }
  );

  it("reports the queue id and exact public run when a permalink's internal root is ambiguous", async () => {
    const environment = {
      environmentId: "env",
      scope: "global" as const,
      url: "https://public/job/team/"
    };
    const state = new BuildDetailsPanelState();
    state.resetForLoad(environment, `${environment.url}job/app/lastBuild/`, "nonce");
    const details = {
      number: 10,
      url: "http://internal/job/team/job/app/10/",
      building: false,
      result: "SUCCESS",
      queueId: 77
    };
    const claimPanelCompletion = vi.fn().mockResolvedValue({ disposition: "tracker" });
    const runtime = new BuildDetailsPanelRuntime({
      state,
      completionTracker: {
        claimPanelCompletion,
        observeBuildIdentity: vi.fn(),
        observeRunningBuild: vi.fn(),
        rejectMismatchedBuild: vi.fn(),
        recordPanelCompletion: vi.fn()
      },
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
      await runtime.showCompletionToast(details);
      assert.deepEqual(claimPanelCompletion.mock.calls[0][0], {
        notice: {
          environment,
          buildUrl: `${environment.url}job/app/10/`,
          observedUrl: `${environment.url}job/app/lastBuild/`,
          buildNumber: 10,
          label: "app #10",
          result: "SUCCESS",
          queueId: 77
        },
        previouslyDelivered: false
      });
    } finally {
      runtime.dispose();
    }
  });

  it.each(["job/app", "plugin/runs"])(
    "stops the original follow when the terminal response from %s/42 identifies build 43",
    async (path) => {
      const environment = { url: "https://ci/", environmentId: "ci", scope: "global" as const };
      const buildUrl = `${environment.url}${path}/42/`;
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, buildUrl, "nonce");
      const tracker = new BuildCompletionTracker(
        { getBuildDetails: vi.fn(), getQueueItem: vi.fn() },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
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
        const completed = vi.fn();
        tracker.onDidNotifyCompletion(completed);
        tracker.follow({ environment, buildUrl, buildNumber: 42, label: "app #42" }, "configured");
        const details = await state.readBuildDetails(async () => ({
          number: 43,
          url: `${environment.url}job/app/43/`,
          building: false,
          result: "SUCCESS"
        }));
        runtime.receiveBuildDetails(1, details);
        runtime.onBuildDetailsApplied(details);
        await runtime.showCompletionToast(details);
        assert.equal(tracker.count, 0);
        assert.equal(completed.mock.calls.length, 0);
        assert.match(showWarningMessage.mock.lastCall?.[0], /different build identity/);
      } finally {
        runtime.dispose();
        tracker.dispose();
      }
    }
  );

  it.each([17, undefined])(
    "keeps the replacement follow when the panel redelivers an old result with queue ID %s",
    async (queueId) => {
      vi.useFakeTimers();
      const environment = { url: "https://ci/", environmentId: "ci", scope: "global" as const };
      const url = `${environment.url}job/app/42/`;
      const original = { number: 42, url, queueId: 17, building: false, result: "FAILURE" };
      const replacement = { number: 42, url, queueId: 18, building: true };
      const target = { environment, buildNumber: 42, buildUrl: url, label: "app #42" };
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, url, "nonce");
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn(), getBuildDetails: async () => replacement },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
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
      const completed: Array<number | undefined> = [];
      tracker.onDidNotifyCompletion((build) => {
        if (build.source === "panel") return;
        state.recordFollowedBuildCompletion(build);
        completed.push(build.queueId);
      });
      try {
        tracker.follow({ ...target, queueId: 17 });
        state.updateDetails(original);
        await runtime.showCompletionToast(original);
        assert.deepEqual(completed, [17]);

        tracker.follow(target);
        await vi.advanceTimersToNextTimerAsync();
        assert.equal(tracker.isFollowingQueueItem(environment, 18), true);
        const late = { ...original, queueId };
        state.updateDetails(late);
        await runtime.showCompletionToast(late);
        assert.equal(tracker.isFollowingQueueItem(environment, 18), true);
        assert.deepEqual(completed, [17]);

        const result = { ...replacement, building: false, result: "SUCCESS" };
        state.updateDetails(result);
        await runtime.showCompletionToast(result);
        assert.deepEqual(completed, [17, 18]);
        assert.equal(tracker.count, 0);
      } finally {
        runtime.dispose();
        tracker.dispose();
        vi.useRealTimers();
      }
    }
  );

  it.each(["tracker", "panel"])(
    "confirms an unidentified terminal response before the replacement completes in the %s",
    async (source) => {
      vi.useFakeTimers();
      const environment = { url: "https://ci/", environmentId: "ci", scope: "global" as const };
      const url = `${environment.url}job/app/42/`;
      const replacement = { number: 42, url, queueId: 18, building: true };
      const getBuildDetails = vi
        .fn()
        .mockResolvedValueOnce(replacement)
        .mockResolvedValue({ ...replacement, building: false, result: "FAILURE" });
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, url, "nonce");
      const tracker = new BuildCompletionTracker(
        { getQueueItem: vi.fn(), getBuildDetails },
        {
          isCurrentController: () => true,
          refreshEnvironment: vi.fn(),
          showBuildDetails: vi.fn(),
          previewLog: vi.fn()
        }
      );
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
      const completed: Array<number | undefined> = [];
      tracker.onDidNotifyCompletion((build) => {
        if (build.source === "panel") return;
        state.recordFollowedBuildCompletion(build);
        completed.push(build.queueId);
      });
      try {
        tracker.follow({
          environment,
          buildNumber: 42,
          buildUrl: url,
          queueId: 18,
          label: "app #42"
        });
        state.updateDetails(replacement);
        const late = { number: 42, url, building: false, result: "FAILURE" };
        state.updateDetails(late);
        const toast = runtime.showCompletionToast(late);
        await vi.advanceTimersByTimeAsync(0);
        assert.equal(getBuildDetails.mock.calls.length, 1);
        assert.deepEqual(completed, []);
        assert.equal(tracker.isFollowingQueueItem(environment, 18), true);
        assert.ok(resolveInformationMessage);
        resolveInformationMessage(undefined);
        await toast;

        state.updateDetails(replacement);
        assert.equal(state.getRunningFollowTarget()?.queueId, 18);
        if (source === "tracker") {
          await vi.advanceTimersToNextTimerAsync();
        } else {
          const actual = { ...replacement, building: false, result: "FAILURE" };
          await runtime.showCompletionToast(actual);
        }
        assert.deepEqual(completed, [18]);
        assert.equal(tracker.count, 0);
        assert.equal(state.getRunningFollowTarget(), undefined);
      } finally {
        runtime.dispose();
        tracker.dispose();
        vi.useRealTimers();
      }
    }
  );

  it.each([
    ["job/example/1/", "job/example/1/", 1],
    ["job/example/lastBuild/", "job/example/1/", 1],
    ["job/example/lastBuild/", "job/example/custom-runs/1/", 1],
    ["job/example/0?view=full", "job/example/0/", 0]
  ] as const)(
    "opens the completed run for %s even after the panel moves",
    async (selector, completedPath, number) => {
      openedUrls.length = 0;
      const completedBuildUrl = `https://jenkins.example/${completedPath}`;
      const state = new BuildDetailsPanelState();
      const environment = {
        url: "https://jenkins.example/",
        environmentId: "env",
        scope: "global" as const
      };
      state.resetForLoad(environment, environment.url + selector, "first");
      const runtime = new BuildDetailsPanelRuntime({
        state,
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
      const details: JenkinsBuildDetails = {
        number,
        url: completedBuildUrl,
        building: false,
        result: "SUCCESS"
      };

      resolveInformationMessage = undefined;
      await runtime.showCompletionToast({ ...details, building: undefined });
      assert.equal(resolveInformationMessage, undefined);
      const toast = runtime.showCompletionToast(details);
      state.resetForLoad(environment, "https://jenkins.example/job/example/2/", "second");
      const select = resolveInformationMessage as ((selection: string) => void) | undefined;
      assert.ok(select);
      select("Open in Jenkins");
      await toast;

      assert.deepEqual(openedUrls, [completedBuildUrl]);
      runtime.dispose();
    }
  );
});

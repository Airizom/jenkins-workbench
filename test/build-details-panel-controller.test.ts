import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { BuildDetailsDiagnosticConsoleSync } from "../src/panels/buildDetails/BuildDetailsDiagnosticConsoleSync";
import { BuildDetailsPanelController } from "../src/panels/buildDetails/BuildDetailsPanelController";
import { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";
import { LoadTokenTracker } from "../src/panels/shared/PanelRuntimeHelpers";

vi.mock("../src/panels/buildDetails/BuildDetailsConfig", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/panels/buildDetails/BuildDetailsConfig")>();
  return {
    ...actual,
    getBuildDetailsRefreshIntervalMs: () => 5000
  };
});

const environment = {
  environmentId: "environment",
  scope: "workspace",
  url: "https://jenkins.example/"
} as const;
const buildUrl = "https://jenkins.example/job/example/1/";

function withControllerPrototype(fields: Record<string, unknown>): BuildDetailsPanelController {
  return Object.assign(Object.create(BuildDetailsPanelController.prototype), fields);
}

function createDiagnosticConsoleSync(
  getConsoleTextProgressive: (...args: unknown[]) => Promise<{ text: string }>,
  changed: () => void,
  initialText = ""
): BuildDetailsDiagnosticConsoleSync {
  const sync = new BuildDetailsDiagnosticConsoleSync({
    maxConsoleChars: 100_000,
    getBackend: () => ({ getConsoleTextProgressive }) as never,
    getEnvironment: () => environment,
    getBuildUrl: () => buildUrl,
    getLoadToken: () => 3,
    isLoadTokenCurrent: (token) => token === 3,
    onTextChanged: changed
  });
  sync.setText(initialText);
  return sync;
}

describe("BuildDetailsPanelController", () => {
  it("retries build details through a full load", async () => {
    const backend = {};
    const environment = { id: "environment" };
    const options = { label: "Build", panelState: { selectedTab: "console" } };
    const load = vi.fn().mockResolvedValue({ status: "ok" });
    const controller = {
      backend,
      state: {
        environment,
        currentBuildUrl: "https://jenkins.example/job/example/1/"
      },
      load
    } as unknown as BuildDetailsPanelController;

    await BuildDetailsPanelController.prototype.refreshBuildDetails.call(controller, options);

    assert.deepEqual(load.mock.calls, [
      [backend, environment, "https://jenkins.example/job/example/1/", options]
    ]);
  });

  it("does not render or activate runtime work when disposed before the initial load resolves", async () => {
    let resolveInitial: (state: unknown) => void = () => undefined;
    const loadInitial = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        })
    );
    const pollingController = { loadInitial, dispose: vi.fn(), start: vi.fn() };
    const pipelineNodeLogManager = { dispose: vi.fn() };
    const loadTokenTracker = new LoadTokenTracker();
    const applyInitialStateAndRender = vi.fn();
    const activateInitialRuntime = vi.fn(async () => undefined);
    const controller = withControllerPrototype({
      loadTokenTracker,
      state: { currentNonce: "nonce" },
      view: { resolveAssetsAndRenderLoading: vi.fn(() => ({ scriptUri: "", styleUris: [] })) },
      runtime: { dispose: vi.fn() },
      loadTracker: { resetLoadingRequests: vi.fn() },
      diagnosticConsoleSync: { dispose: vi.fn() },
      prepareLoad: vi.fn(() => loadTokenTracker.next()),
      createPipelineNodeLogManager: vi.fn(() => pipelineNodeLogManager),
      createPollingController: vi.fn(() => pollingController),
      applyInitialStateAndRender,
      activateInitialRuntime
    });

    const loadPromise = BuildDetailsPanelController.prototype.load.call(
      controller,
      {} as never,
      environment as never,
      buildUrl
    );
    assert.equal(loadInitial.mock.calls.length, 1);

    BuildDetailsPanelController.prototype.dispose.call(controller);
    resolveInitial({ details: { building: true }, errors: [] });
    const result = await loadPromise;

    assert.deepEqual(result, { status: "ok" });
    assert.equal(applyInitialStateAndRender.mock.calls.length, 0);
    assert.equal(activateInitialRuntime.mock.calls.length, 0);
    assert.equal(pollingController.dispose.mock.calls.length, 1);
    assert.equal(pipelineNodeLogManager.dispose.mock.calls.length, 1);
  });

  it("keeps node logs paused when the panel is hidden during the visibility refresh", async () => {
    let resolveVisible: (stillVisible: boolean) => void = () => undefined;
    const runtime = {
      handlePanelVisible: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveVisible = resolve;
          })
      ),
      handlePanelHidden: vi.fn()
    };
    const pipelineNodeLogManager = { pause: vi.fn(), resume: vi.fn() };
    let visible = true;
    const controller = withControllerPrototype({
      loadTokenTracker: new LoadTokenTracker(),
      runtime,
      pipelineNodeLogManager,
      view: { isVisible: () => visible },
      loadTracker: { beginLoading: vi.fn(() => 1), endLoading: vi.fn() }
    });

    const visiblePromise =
      BuildDetailsPanelController.prototype.handlePanelVisible.call(controller);
    visible = false;
    BuildDetailsPanelController.prototype.handlePanelHidden.call(controller);
    resolveVisible(false);
    await visiblePromise;

    assert.equal(pipelineNodeLogManager.pause.mock.calls.length, 1);
    assert.equal(pipelineNodeLogManager.resume.mock.calls.length, 0);
    assert.equal(runtime.handlePanelHidden.mock.calls.length, 1);
  });

  it("resumes node logs when the panel stays visible through the visibility refresh", async () => {
    const runtime = {
      handlePanelVisible: vi.fn(async () => true),
      handlePanelHidden: vi.fn()
    };
    const pipelineNodeLogManager = { pause: vi.fn(), resume: vi.fn() };
    const controller = withControllerPrototype({
      loadTokenTracker: new LoadTokenTracker(),
      runtime,
      pipelineNodeLogManager,
      view: { isVisible: () => true },
      loadTracker: { beginLoading: vi.fn(() => 1), endLoading: vi.fn() }
    });

    await BuildDetailsPanelController.prototype.handlePanelVisible.call(controller);

    assert.equal(pipelineNodeLogManager.resume.mock.calls.length, 1);
  });

  it("retries the initial status fetch when the first details request fails", async () => {
    vi.useFakeTimers();
    try {
      const loadTokenTracker = new LoadTokenTracker();
      const token = loadTokenTracker.next();
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, buildUrl, "nonce");
      state.applyInitialState(
        { errors: ["Build details: connection reset"] },
        undefined,
        "Pipeline stages: unavailable"
      );
      const details = { number: 1, url: buildUrl, building: false, result: "SUCCESS" };
      const refreshBuildStatus = vi.fn(async (): Promise<void> => {
        if (refreshBuildStatus.mock.calls.length === 1) {
          return;
        }
        state.updateDetails(details as never);
      });
      const refreshTestReport = vi.fn(async () => undefined);
      const refreshCoverage = vi.fn(async () => undefined);
      const postErrors = vi.fn();
      const controller = withControllerPrototype({
        loadTokenTracker,
        state,
        view: { isVisible: () => true, postErrors },
        runtime: { refreshBuildStatus, refreshTestReport, refreshCoverage },
        pollingController: { start: vi.fn() }
      });
      const activate = (
        BuildDetailsPanelController.prototype as unknown as {
          activateInitialRuntime: (
            details: unknown,
            workflowError: unknown,
            token: number
          ) => Promise<void>;
        }
      ).activateInitialRuntime;

      await activate.call(controller, undefined, undefined, token);
      assert.equal(refreshBuildStatus.mock.calls.length, 0);

      await vi.advanceTimersByTimeAsync(5000);
      assert.equal(refreshBuildStatus.mock.calls.length, 1);
      assert.equal(refreshTestReport.mock.calls.length, 0);

      await vi.advanceTimersByTimeAsync(5000);
      assert.equal(refreshBuildStatus.mock.calls.length, 2);
      assert.equal(state.currentDetails, details);
      assert.deepEqual(state.currentErrors, ["Pipeline stages: unavailable"]);
      assert.deepEqual(postErrors.mock.calls, [[["Pipeline stages: unavailable"]]]);
      assert.equal(refreshTestReport.mock.calls.length, 1);
      assert.equal(refreshCoverage.mock.calls.length, 1);

      await vi.advanceTimersByTimeAsync(30000);
      assert.equal(refreshBuildStatus.mock.calls.length, 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds initial status retries and stops them when the load is superseded", async () => {
    vi.useFakeTimers();
    try {
      const loadTokenTracker = new LoadTokenTracker();
      const token = loadTokenTracker.next();
      const state = new BuildDetailsPanelState();
      state.resetForLoad(environment, buildUrl, "nonce");
      const refreshBuildStatus = vi.fn(async () => undefined);
      const controller = withControllerPrototype({
        loadTokenTracker,
        state,
        view: { isVisible: () => true, postErrors: vi.fn() },
        runtime: { refreshBuildStatus }
      });
      const activate = (
        BuildDetailsPanelController.prototype as unknown as {
          activateInitialRuntime: (
            details: unknown,
            workflowError: unknown,
            token: number
          ) => Promise<void>;
        }
      ).activateInitialRuntime;

      await activate.call(controller, undefined, undefined, token);
      await vi.advanceTimersByTimeAsync(5000 * 10);
      assert.equal(refreshBuildStatus.mock.calls.length, 5);

      await activate.call(controller, undefined, undefined, token);
      loadTokenTracker.next();
      await vi.advanceTimersByTimeAsync(5000 * 10);
      assert.equal(refreshBuildStatus.mock.calls.length, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes the exact raw console byte window used for HTML diagnostic offsets", async () => {
    const changed = vi.fn();
    const getConsoleTextProgressive = vi.fn(async () => ({ text: "new HTML-backed text" }));
    const sync = createDiagnosticConsoleSync(getConsoleTextProgressive, changed, "old text");

    await sync.sync({ start: 7, end: 29 });

    assert.equal(sync.getText(), "new HTML-backed text");
    assert.deepEqual(getConsoleTextProgressive.mock.calls, [[environment, buildUrl, 7, 22]]);
    assert.equal(changed.mock.calls.length, 1);
  });

  it("fetches and appends only the new raw text bytes for HTML append updates", async () => {
    const changed = vi.fn();
    const getConsoleTextProgressive = vi.fn(async () => ({ text: "tail" }));
    const sync = createDiagnosticConsoleSync(getConsoleTextProgressive, changed, "seed");

    await sync.sync({ start: 0, end: 8 }, { start: 4, end: 8 });

    assert.equal(sync.getText(), "seedtail");
    assert.deepEqual(getConsoleTextProgressive.mock.calls, [[environment, buildUrl, 4, 4]]);
    assert.equal(changed.mock.calls.length, 1);
  });

  it("clears diagnostic console offsets when current HTML text synchronization fails", async () => {
    const changed = vi.fn();
    const getConsoleTextProgressive = async (): Promise<{ text: string }> => {
      throw new Error("console text unavailable");
    };
    const sync = createDiagnosticConsoleSync(
      getConsoleTextProgressive,
      changed,
      "stale HTML-backed text"
    );

    await sync.sync({ start: 20, end: 40 });

    assert.equal(sync.getText(), "");
    assert.equal(changed.mock.calls.length, 1);
  });
});

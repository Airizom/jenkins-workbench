import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  BuildDetailsNavigation,
  type BuildDetailsNavigationEntry
} from "../src/panels/buildDetails/BuildDetailsNavigation";
import type { BuildDetailsPanelSerializedState } from "../src/panels/buildDetails/shared/BuildDetailsPanelWebviewState";

vi.doMock("vscode", () => ({ window: { showErrorMessage: vi.fn(async () => undefined) } }));
const { BuildDetailsPanel, toPipelineLogTargetViewModel, toPipelineNodeSelection } = await import(
  "../src/panels/BuildDetailsPanel"
);

const environment = {
  environmentId: "environment",
  scope: "workspace" as const,
  url: "https://jenkins.example/"
};

function entry(number: number): BuildDetailsNavigationEntry {
  return {
    environment,
    buildUrl: `https://jenkins.example/job/example/${number}/`,
    label: `example #${number}`
  };
}

function state(number: number): BuildDetailsPanelSerializedState {
  return {
    environmentId: environment.environmentId,
    scope: environment.scope,
    buildUrl: entry(number).buildUrl,
    buildDetailsUi: { selectedTab: "console" }
  };
}

describe("BuildDetailsNavigation", () => {
  it("navigates backward and forward only after successful commits", () => {
    const history = new BuildDetailsNavigation();
    assert.equal(history.canGoBack, false);
    assert.equal(history.canGoForward, false);
    history.record(entry(1));
    history.record(entry(2));
    const back = history.target("back");
    assert.equal(back?.entry.buildUrl, entry(1).buildUrl);
    // Fetching a target alone cannot move the current position.
    assert.equal(history.canGoForward, false);
    assert.ok(back);
    history.commit(back, back.entry);
    assert.equal(history.canGoBack, false);
    assert.equal(history.canGoForward, true);
    const forward = history.target("forward");
    assert.ok(forward);
    history.commit(forward, forward.entry);
    assert.equal(history.canGoBack, true);
    assert.equal(history.canGoForward, false);
  });

  it("restores isolated per-entry UI state", () => {
    const history = new BuildDetailsNavigation();
    history.record(entry(1));
    const snapshot = state(1);
    history.snapshot(snapshot);
    snapshot.buildDetailsUi = { selectedTab: "tests" };
    history.record(entry(2));
    const back = history.target("back");
    assert.deepEqual(back?.entry.panelState?.buildDetailsUi, { selectedTab: "console" });
    assert.ok(back);
    assert.ok(back.entry.panelState);
    back.entry.panelState.buildDetailsUi = { selectedTab: "pipeline" };
    assert.deepEqual(history.target("back")?.entry.panelState?.buildDetailsUi, {
      selectedTab: "console"
    });
  });

  it("does not save a stale UI snapshot onto another build", () => {
    const history = new BuildDetailsNavigation();
    history.record(entry(1));
    history.snapshot(state(2));
    history.record(entry(2));
    assert.equal(history.target("back")?.entry.panelState, undefined);
  });

  it("deduplicates consecutive targets and truncates forward history on a new target", () => {
    const history = new BuildDetailsNavigation();
    history.record(entry(1));
    history.record({ ...entry(1), buildUrl: entry(1).buildUrl.slice(0, -1) });
    assert.equal(history.canGoBack, false);
    history.record(entry(2));
    history.record(entry(3));
    const back = history.target("back");
    assert.ok(back);
    history.commit(back, back.entry);
    history.record(entry(4));
    assert.equal(history.canGoForward, false);
    assert.equal(history.target("back")?.entry.buildUrl, entry(2).buildUrl);
  });

  it("caps history at 50 targets", () => {
    const history = new BuildDetailsNavigation();
    for (let number = 1; number <= 60; number++) history.record(entry(number));
    let oldest: number | undefined;
    let backwardSteps = 0;
    for (let target = history.target("back"); target; target = history.target("back")) {
      history.commit(target, target.entry);
      oldest = Number(target.entry.buildUrl.split("/").at(-2));
      backwardSteps++;
    }
    assert.equal(backwardSteps, 49);
    assert.equal(oldest, 11);
  });

  it("clears history for a different environment identity, scope, or URL", () => {
    for (const changed of [
      { environmentId: "other" },
      { scope: "global" as const },
      { url: "https://jenkins.example/new-context/" }
    ]) {
      const history = new BuildDetailsNavigation();
      history.record(entry(1));
      history.record(entry(2));
      history.setEnvironment({ ...environment, ...changed });
      assert.equal(history.canGoBack, false);
      assert.equal(history.canGoForward, false);
      assert.equal(history.target("back"), undefined);
    }
  });

  it("ignores an invalid history commit", () => {
    const history = new BuildDetailsNavigation();
    history.record(entry(1));
    history.record(entry(2));
    history.commit({ index: 9, entry: entry(1) }, entry(1));
    history.commit({ index: 0, entry: entry(1) }, entry(3));
    assert.equal(history.canGoForward, false);
  });
});

interface TestPanel {
  navigateToBuild(buildUrl: string, label?: string): Promise<void>;
  navigationGeneration: number;
  navigationBusy: boolean;
  disposed: boolean;
  load: ReturnType<typeof vi.fn>;
  postNavigation: ReturnType<typeof vi.fn>;
}

function navigationPanel(getBuildDetails: ReturnType<typeof vi.fn>): TestPanel {
  const panel = Object.assign(Object.create(BuildDetailsPanel.prototype), {
    controller: {
      getCurrentDetails: () => undefined,
      getBackend: () => ({ status: { getBuildDetails } }),
      getEnvironment: () => environment,
      getBuildUrl: () => entry(1).buildUrl,
      getLoadToken: () => 1
    },
    artifactActionHandler: {},
    navigationGeneration: 0,
    navigationBusy: false,
    disposed: false,
    load: vi.fn(async () => undefined),
    postNavigation: vi.fn()
  });
  return panel as TestPanel;
}

describe("BuildDetailsPanel navigation preflight", () => {
  it("records a displayed source while its test and coverage activation is still pending", async () => {
    const panel = navigationPanel(vi.fn(async () => ({ number: 2, url: entry(2).buildUrl })));
    const history = new BuildDetailsNavigation();
    Object.assign(panel, {
      navigation: history,
      currentLoadComplete: false,
      serializedState: state(1)
    });
    const controller = (panel as unknown as { controller: { getCurrentDetails: () => unknown } })
      .controller;
    controller.getCurrentDetails = () => ({ number: 1, url: entry(1).buildUrl });
    await panel.navigateToBuild(entry(2).buildUrl);
    history.record(entry(2));
    const back = history.target("back");
    assert.equal(back?.entry.buildUrl, entry(1).buildUrl);
    assert.deepEqual(back?.entry.panelState?.buildDetailsUi, { selectedTab: "console" });
  });

  it("checks target access before loading and reuses the fetched details", async () => {
    const details = { number: 2, url: entry(2).buildUrl };
    const getBuildDetails = vi.fn(async () => details);
    const panel = navigationPanel(getBuildDetails);
    await panel.navigateToBuild(entry(2).buildUrl, entry(2).label);
    assert.deepEqual(getBuildDetails.mock.calls, [
      [environment, entry(2).buildUrl, { includeCauses: true, bypassCache: true }]
    ]);
    assert.equal(panel.load.mock.calls.length, 1);
    const loadArguments = panel.load.mock.calls[0] as unknown[];
    assert.deepEqual(loadArguments[6], {
      generation: 1,
      target: undefined,
      initialDetails: details
    });
    assert.equal(panel.navigationBusy, false);
  });

  it("leaves the source visible when a related build is unavailable", async () => {
    const panel = navigationPanel(
      vi.fn(async () => {
        throw new Error("Not found");
      })
    );
    await panel.navigateToBuild(entry(2).buildUrl);
    assert.equal(panel.load.mock.calls.length, 0);
    assert.equal(panel.navigationBusy, false);
  });

  it("drops a late preflight response after an external load", async () => {
    let resolve!: (value: unknown) => void;
    const panel = navigationPanel(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
    );
    const pending = panel.navigateToBuild(entry(2).buildUrl);
    panel.navigationGeneration++;
    resolve({ number: 2, url: entry(2).buildUrl });
    await pending;
    assert.equal(panel.load.mock.calls.length, 0);
  });

  it("drops a late preflight response after disposal", async () => {
    let resolve!: (value: unknown) => void;
    const panel = navigationPanel(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
    );
    const pending = panel.navigateToBuild(entry(2).buildUrl);
    panel.disposed = true;
    resolve({ number: 2, url: entry(2).buildUrl });
    await pending;
    assert.equal(panel.load.mock.calls.length, 0);
  });

  it("ignores duplicate clicks and the current build", async () => {
    const getBuildDetails = vi.fn(async () => ({ number: 2, url: entry(2).buildUrl }));
    const panel = navigationPanel(getBuildDetails);
    await panel.navigateToBuild(entry(1).buildUrl);
    panel.navigationBusy = true;
    await panel.navigateToBuild(entry(2).buildUrl);
    assert.equal(getBuildDetails.mock.calls.length, 0);
  });
});

interface LoadableTestPanel {
  load(
    backend: unknown,
    artifacts: unknown,
    selectedEnvironment: typeof environment,
    buildUrl: string,
    label?: string,
    selection?: unknown,
    navigationLoad?: unknown
  ): Promise<void>;
  navigation: BuildDetailsNavigation;
  navigationGeneration: number;
  serializedState?: BuildDetailsPanelSerializedState;
  currentLoadComplete: boolean;
  recordRecoveredNavigation(): void;
  receiveDetails(number: number): void;
}

function loadablePanel(initialStatusUnavailable = false): LoadableTestPanel {
  let statusUnavailable = initialStatusUnavailable;
  let currentUrl: string | undefined;
  let currentDetails: { number: number; url: string; displayName: string } | undefined;
  let currentEnvironment = environment;
  const receiveDetails = (number: number): void => {
    currentDetails = { number, url: entry(number).buildUrl, displayName: `#${number}` };
  };
  const controller = {
    load: vi.fn(async (_backend, _environment, url) => {
      currentUrl = url;
      currentEnvironment = _environment;
      const number = Number(url.split("/").at(-2));
      currentDetails = statusUnavailable ? undefined : { number, url, displayName: `#${number}` };
      statusUnavailable = false;
      return { status: "ok" };
    }),
    getCurrentDetails: () => currentDetails,
    getEnvironment: () => currentEnvironment,
    getBuildUrl: () => currentUrl
  };
  return Object.assign(Object.create(BuildDetailsPanel.prototype), {
    controller,
    navigation: new BuildDetailsNavigation(),
    navigationGeneration: 0,
    navigationBusy: false,
    currentLoadComplete: false,
    disposed: false,
    receiveDetails,
    buildDiagnosticsCoordinator: { setPanelOwner: vi.fn() },
    postCurrentBuildDiagnostics: vi.fn(),
    postNavigation: vi.fn(),
    updateHistory: vi.fn()
  }) as LoadableTestPanel;
}

describe("BuildDetailsPanel navigation load integration", () => {
  it("records a recovered initial target and its UI state before navigating away", async () => {
    const panel = loadablePanel(true);
    await panel.load({}, {}, environment, entry(1).buildUrl);
    assert.equal(panel.navigation.target("back"), undefined);
    panel.serializedState = state(1);
    panel.receiveDetails(1);
    panel.recordRecoveredNavigation();
    await panel.load({}, {}, environment, entry(2).buildUrl);
    const back = panel.navigation.target("back");
    assert.equal(back?.entry.buildUrl, entry(1).buildUrl);
    assert.deepEqual(back?.entry.panelState?.buildDetailsUi, { selectedTab: "console" });
  });

  it("does not record recovered details during a load or discard forward entries", async () => {
    const panel = loadablePanel();
    await panel.load({}, {}, environment, entry(1).buildUrl);
    panel.currentLoadComplete = false;
    panel.serializedState = state(2);
    panel.receiveDetails(2);
    panel.recordRecoveredNavigation();
    assert.equal(panel.navigation.canGoBack, false);
    await panel.load({}, {}, environment, entry(2).buildUrl);
    const back = panel.navigation.target("back");
    assert.ok(back);
    const generation = ++panel.navigationGeneration;
    await panel.load({}, {}, environment, back.entry.buildUrl, undefined, undefined, {
      generation,
      target: back,
      initialDetails: { number: 1, url: entry(1).buildUrl }
    });
    assert.equal(panel.navigation.canGoForward, true);
    panel.recordRecoveredNavigation();
    assert.equal(panel.navigation.canGoForward, true);
    assert.equal(panel.navigation.target("forward")?.entry.buildUrl, entry(2).buildUrl);
  });

  it("records external opens and restores the saved tab when going back", async () => {
    const panel = loadablePanel();
    await panel.load({}, {}, environment, entry(1).buildUrl);
    panel.serializedState = state(1);
    await panel.load({}, {}, environment, entry(2).buildUrl);
    assert.equal(panel.navigation.canGoBack, true);
    const target = panel.navigation.target("back");
    assert.ok(target);
    const generation = ++panel.navigationGeneration;
    await panel.load({}, {}, environment, target.entry.buildUrl, undefined, undefined, {
      generation,
      target,
      initialDetails: { number: 1, url: entry(1).buildUrl }
    });
    assert.equal(
      (panel.serializedState?.buildDetailsUi as { selectedTab?: string })?.selectedTab,
      "console"
    );
    assert.equal(panel.navigation.canGoBack, false);
    assert.equal(panel.navigation.canGoForward, true);
  });

  it("does not commit a navigation request invalidated before loading", async () => {
    const panel = loadablePanel();
    await panel.load({}, {}, environment, entry(1).buildUrl);
    const before = panel.serializedState;
    await panel.load({}, {}, environment, entry(2).buildUrl, undefined, undefined, {
      generation: panel.navigationGeneration - 1,
      initialDetails: { number: 2, url: entry(2).buildUrl }
    });
    assert.equal(panel.serializedState, before);
    assert.equal(panel.navigation.canGoBack, false);
  });

  it("clears navigation when an external open switches environment", async () => {
    const panel = loadablePanel();
    await panel.load({}, {}, environment, entry(1).buildUrl);
    await panel.load({}, {}, environment, entry(2).buildUrl);
    await panel.load({}, {}, { ...environment, environmentId: "other" }, entry(3).buildUrl);
    assert.equal(panel.navigation.canGoBack, false);
    assert.equal(panel.navigation.canGoForward, false);
  });
});

describe("BuildDetailsPanel pipeline node selection mapping", () => {
  it("round-trips a deep-link selection through the log target view model", () => {
    for (const selection of [
      { kind: "stage" as const, nodeId: "12", name: "Build" },
      { kind: "step" as const, nodeId: "40", name: "sh: make test" }
    ]) {
      assert.deepEqual(toPipelineNodeSelection(toPipelineLogTargetViewModel(selection)), selection);
    }
  });

  it("keeps the default name and drops targets without a node id", () => {
    assert.deepEqual(
      toPipelineNodeSelection(toPipelineLogTargetViewModel({ kind: "step", nodeId: " 7 " })),
      { kind: "step", nodeId: "7", name: "Step" }
    );
    assert.equal(
      toPipelineNodeSelection({
        key: "stage::Build",
        kind: "stage",
        name: "Build",
        childNodeIds: ["3"]
      }),
      undefined
    );
    assert.equal(toPipelineNodeSelection(undefined), undefined);
  });
});

describe("BuildDetailsPanel.getCurrentBuildContext", () => {
  type PanelStatics = { currentPanel: unknown };

  it("returns undefined without an open panel and the loaded build otherwise", () => {
    const statics = BuildDetailsPanel as unknown as PanelStatics;
    const previous = statics.currentPanel;
    try {
      statics.currentPanel = undefined;
      assert.equal(BuildDetailsPanel.getCurrentBuildContext(), undefined);

      const target = { key: "k", kind: "stage", name: "Build", nodeId: "12" };
      statics.currentPanel = Object.assign(Object.create(BuildDetailsPanel.prototype), {
        disposed: false,
        controller: {
          getEnvironment: () => environment,
          getBuildUrl: () => entry(5).buildUrl,
          getCurrentDetails: () => ({ fullDisplayName: "example #5" }),
          getCurrentPipelineNodeLog: () => ({ target, text: "", truncated: false, loading: false })
        }
      });
      assert.deepEqual(BuildDetailsPanel.getCurrentBuildContext(), {
        environment,
        buildUrl: entry(5).buildUrl,
        label: "example #5",
        pipelineNode: { kind: "stage", nodeId: "12", name: "Build" }
      });

      statics.currentPanel = Object.assign(Object.create(BuildDetailsPanel.prototype), {
        disposed: false,
        controller: {
          getEnvironment: () => environment,
          getBuildUrl: () => "https://jenkins.example/view/All/job/example/6/",
          getCurrentDetails: () => undefined,
          getCurrentPipelineNodeLog: () => undefined
        }
      });
      assert.equal(BuildDetailsPanel.getCurrentBuildContext()?.buildUrl, entry(6).buildUrl);

      statics.currentPanel = Object.assign(Object.create(BuildDetailsPanel.prototype), {
        disposed: false,
        controller: { getEnvironment: () => environment, getBuildUrl: () => undefined }
      });
      assert.equal(BuildDetailsPanel.getCurrentBuildContext(), undefined);
    } finally {
      statics.currentPanel = previous;
    }
  });
});

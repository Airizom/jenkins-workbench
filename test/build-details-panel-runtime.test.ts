import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";

let resolveInformationMessage: ((selection: string | undefined) => void) | undefined;

vi.doMock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T
    })
  },
  window: {
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

describe("BuildDetailsPanelRuntime", () => {
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

  it("opens the completed build when the panel navigates before the toast action is selected", async () => {
    const completedBuildUrl = "https://jenkins.example/job/example/1/";
    const state = {
      currentBuildUrl: completedBuildUrl,
      takeCompletionToastSlot: () => true
    };
    const runtime = {
      options: { state }
    } as unknown as InstanceType<typeof BuildDetailsPanelRuntime>;
    const details: JenkinsBuildDetails = {
      number: 1,
      url: completedBuildUrl,
      building: false,
      result: "SUCCESS"
    };

    const toast = BuildDetailsPanelRuntime.prototype.showCompletionToast.call(runtime, details);
    state.currentBuildUrl = "https://jenkins.example/job/example/2/";
    assert.ok(resolveInformationMessage);
    resolveInformationMessage("Open in Jenkins");
    await toast;

    assert.deepEqual(openedUrls, [completedBuildUrl]);
  });
});

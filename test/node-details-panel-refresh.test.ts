import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsNodeDetails } from "../src/jenkins/types";
import type { NodeDetailsPanel as NodeDetailsPanelType } from "../src/panels/NodeDetailsPanel";
import * as vscodeStub from "./helpers/vscodeStub";

const errorMessages: string[] = [];
vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    }
  }
}));
const { NodeDetailsPanel } = await import("../src/panels/NodeDetailsPanel");
const { createPanelLoadingTracker } = await import("../src/panels/shared/PanelRuntimeHelpers");

it("keeps advanced details requested when an environment refresh interrupts the first request", async () => {
  const details: JenkinsNodeDetails = {
    displayName: "agent-1",
    offline: false,
    temporarilyOffline: false
  };
  let resolveFirst!: (value: JenkinsNodeDetails) => void;
  const firstRequest = new Promise<JenkinsNodeDetails>((resolve) => {
    resolveFirst = resolve;
  });
  const getNodeDetails = vi
    .fn()
    .mockImplementationOnce(() => firstRequest)
    .mockResolvedValue(details);
  const postMessage = vi.fn();
  const panel = Object.assign(Object.create(NodeDetailsPanel.prototype), {
    dataService: { getNodeDetails },
    environment: { environmentId: "environment", url: "https://jenkins.example/" },
    nodeUrl: "https://jenkins.example/computer/agent-1/",
    hasRendered: true,
    advancedLoaded: false,
    advancedRequested: false,
    disposed: false,
    panel: { visible: true, webview: { postMessage } },
    loadTracker: createPanelLoadingTracker(() => {})
  }) as NodeDetailsPanelType;

  const advancedRequest = panel["loadAdvancedDetails"]();
  const refresh = panel["handleEnvironmentRefresh"]("environment");
  await refresh;
  resolveFirst(details);
  await advancedRequest;

  assert.deepEqual(
    getNodeDetails.mock.calls.map((call) => call[2].detailLevel),
    ["advanced", "advanced"]
  );
  const updates = postMessage.mock.calls
    .map((call) => call[0])
    .filter((message) => message.type === "updateNodeDetails");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payload.advancedLoaded, true);
});

function createPanel(overrides: Record<string, unknown> = {}) {
  const postMessage = vi.fn();
  const panel = Object.assign(Object.create(NodeDetailsPanel.prototype), {
    environment: {
      environmentId: "environment",
      scope: "workspace",
      url: "https://jenkins.example/"
    },
    nodeUrl: "https://jenkins.example/computer/agent-1/",
    hasRendered: true,
    advancedLoaded: false,
    advancedRequested: false,
    disposed: false,
    panel: { visible: true, webview: { postMessage } },
    loadTracker: createPanelLoadingTracker((message) => postMessage(message)),
    ...overrides
  }) as NodeDetailsPanelType;
  const updates = () =>
    postMessage.mock.calls
      .map((call) => call[0])
      .filter((message) => message.type === "updateNodeDetails")
      .map((message) => message.payload);
  return { panel, postMessage, updates };
}

describe("NodeDetailsPanel failed refresh", () => {
  it("keeps the last successful updatedAt, queued work, and flags the refresh as failed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 0, 0));
      const queuedWork = {
        matchingQueueItems: [{ id: 1 }],
        anyQueueItems: [],
        selfLabelQueueItems: []
      };
      const getNodeDetails = vi
        .fn()
        .mockResolvedValueOnce({
          displayName: "agent-1",
          offline: false,
          temporarilyOffline: false
        })
        .mockRejectedValueOnce(new Error("HTTP 502"));
      const { panel, updates } = createPanel({
        dataService: { getNodeDetails },
        nodeQueuedWorkService: { getQueuedWorkForNode: vi.fn().mockResolvedValue(queuedWork) }
      });

      await panel["refreshDetailsWith"]("basic");
      vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 10, 0));
      await panel["refreshDetailsWith"]("basic");

      const [loaded, failed] = updates();
      assert.equal(loaded.updatedAt, "2026-01-01T12:00:00.000Z");
      assert.equal(loaded.refreshFailed, false);
      assert.equal(loaded.environmentLabel, "jenkins.example");
      assert.equal(failed.updatedAt, "2026-01-01T12:00:00.000Z");
      assert.equal(failed.refreshFailed, true);
      assert.equal(failed.detailsAvailable, true);
      assert.deepEqual(failed.queuedWork, queuedWork);
      assert.deepEqual(failed.errors, ["HTTP 502"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark a first-load failure as a failed refresh", async () => {
    const getNodeDetails = vi.fn().mockRejectedValue(new Error("HTTP 404"));
    const { panel, updates } = createPanel({ dataService: { getNodeDetails } });

    await panel["refreshDetailsWith"]("basic");

    const [failed] = updates();
    assert.equal(failed.detailsAvailable, false);
    assert.equal(failed.refreshFailed, false);
  });
});

describe("NodeDetailsPanel node actions", () => {
  const details = { displayName: "agent-1", offline: false, temporarilyOffline: false };

  for (const action of ["bringNodeOnline", "launchNodeAgent"] as const) {
    it(`refreshes after ${action} even when Jenkins reports a no-op`, async () => {
      const getNodeDetails = vi.fn().mockResolvedValue(details);
      const nodeActionService = { [action]: vi.fn().mockResolvedValue(false) };
      const { panel, updates } = createPanel({
        dataService: { getNodeDetails },
        nodeActionService,
        lastDetails: details
      });

      await panel["handleNodeAction"](action);

      assert.equal(nodeActionService[action].mock.calls.length, 1);
      assert.equal(getNodeDetails.mock.calls.length, 1);
      assert.equal(updates().length, 1);
    });
  }

  it("refreshes after an action throws", async () => {
    const getNodeDetails = vi.fn().mockResolvedValue(details);
    const { panel, updates } = createPanel({
      dataService: { getNodeDetails },
      nodeActionService: { bringNodeOnline: vi.fn().mockRejectedValue(new Error("boom")) },
      lastDetails: details
    });

    errorMessages.length = 0;
    await panel["handleNodeAction"]("bringNodeOnline");

    assert.equal(updates().length, 1);
    assert.deepEqual(errorMessages, ["boom"]);
  });

  it("passes the busy executor count to the offline prompt and skips work when cancelled", async () => {
    const getNodeDetails = vi.fn();
    const promptOfflineReason = vi.fn().mockResolvedValue(undefined);
    const takeNodeOffline = vi.fn();
    const { panel } = createPanel({
      dataService: { getNodeDetails },
      nodeActionService: { promptOfflineReason, takeNodeOffline },
      lastDetails: { ...details, busyExecutors: 2 }
    });

    await panel["handleNodeAction"]("takeNodeOffline");

    assert.deepEqual(promptOfflineReason.mock.calls[0], ["agent-1", 2]);
    assert.equal(takeNodeOffline.mock.calls.length, 0);
    assert.equal(getNodeDetails.mock.calls.length, 0);
  });
});

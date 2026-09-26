import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type { JenkinsNodeDetails } from "../src/jenkins/types";
import { NodeDetailsPanel } from "../src/panels/NodeDetailsPanel";
import { createPanelLoadingTracker } from "../src/panels/shared/PanelRuntimeHelpers";

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
  }) as NodeDetailsPanel;

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

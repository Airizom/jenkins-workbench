import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsNodeInfo, JenkinsQueueItemInfo } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { buildNodeCapacityViewModel } from "../src/services/NodeCapacityViewModelBuilder";

const environment: JenkinsEnvironmentRef = {
  environmentId: "prod",
  scope: "global",
  url: "https://jenkins.example/"
};

describe("NodeCapacityViewModelBuilder", () => {
  it("keeps queue items visible when a pool label collides with another node self label", () => {
    const nodes: JenkinsNodeInfo[] = [
      buildNode({
        displayName: "linux",
        name: "agent-a",
        assignedLabels: [{ name: "linux" }]
      }),
      buildNode({
        displayName: "agent-b",
        name: "agent-b",
        assignedLabels: [{ name: "linux" }]
      })
    ];
    const queueItems: JenkinsQueueItemInfo[] = [
      {
        id: 42,
        name: "queued-linux-job",
        position: 1,
        assignedLabelName: "linux",
        buildable: true
      }
    ];

    const viewModel = buildNodeCapacityViewModel(
      environment,
      nodes,
      queueItems,
      "2026-06-14T20:00:00.000Z"
    );

    const linuxPool = viewModel.pools.find(
      (pool) => pool.kind === "label" && pool.label === "linux"
    );
    assert.ok(linuxPool);
    assert.equal(linuxPool.queuedCount, 1);
    assert.equal(linuxPool.queueItems[0]?.name, "queued-linux-job");
    assert.equal(linuxPool.nodes.map((node) => node.name).join(","), "agent-b");
    assert.deepEqual(viewModel.hiddenLabelQueueItems, []);
  });
});

function buildNode(overrides: Partial<JenkinsNodeInfo>): JenkinsNodeInfo {
  return {
    displayName: "agent",
    name: "agent",
    offline: false,
    temporarilyOffline: false,
    numExecutors: 1,
    busyExecutors: 0,
    ...overrides
  };
}

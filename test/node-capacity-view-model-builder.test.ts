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

  it("keeps shared queue metrics consistent between a pool and the overall summary", () => {
    const nodes: JenkinsNodeInfo[] = [
      buildNode({ numExecutors: 2, busyExecutors: 1 }),
      buildNode({ name: "offline-agent", offline: true, numExecutors: 3 })
    ];
    const queueItems: JenkinsQueueItemInfo[] = [
      { id: 1, name: "stuck", position: 1, stuck: true },
      { id: 2, name: "blocked", position: 2, blocked: true },
      { id: 3, name: "buildable", position: 3, buildable: true },
      {
        id: 4,
        name: "all-states",
        position: 4,
        stuck: true,
        blocked: true,
        buildable: true
      }
    ];

    const viewModel = buildNodeCapacityViewModel(
      environment,
      nodes,
      queueItems,
      "2026-06-14T20:00:00.000Z"
    );
    const anyPool = viewModel.pools.find((pool) => pool.kind === "any");
    assert.ok(anyPool);
    const expectedQueueTotals = {
      queuedCount: 4,
      stuckCount: 2,
      blockedCount: 2,
      buildableCount: 2
    };

    assert.deepEqual(selectQueueTotals(anyPool), expectedQueueTotals);
    assert.deepEqual(selectQueueTotals(viewModel.summary), expectedQueueTotals);
    assert.equal(anyPool.totalExecutors, 5);
    assert.equal(viewModel.summary.totalExecutors, 2);
  });
});

function selectQueueTotals(value: {
  queuedCount: number;
  stuckCount: number;
  blockedCount: number;
  buildableCount: number;
}): typeof value {
  return {
    queuedCount: value.queuedCount,
    stuckCount: value.stuckCount,
    blockedCount: value.blockedCount,
    buildableCount: value.buildableCount
  };
}

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

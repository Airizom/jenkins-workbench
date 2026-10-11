import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsNodeInfo, JenkinsQueueItemInfo } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { buildNodeCapacityViewModel } from "../src/services/NodeCapacityViewModelBuilder";
import * as NodeLabelExpression from "../src/services/NodeLabelExpression";

const environment: JenkinsEnvironmentRef = {
  environmentId: "prod",
  scope: "global",
  url: "https://jenkins.example/"
};

describe("NodeCapacityViewModelBuilder", () => {
  it("treats null work as idle and labels offline capacity without claiming it is online", () => {
    const model = buildNodeCapacityViewModel(
      environment,
      [
        buildNode({
          numExecutors: 3,
          busyExecutors: undefined,
          executors: [
            { idle: true, currentExecutable: null, currentWorkUnit: null },
            { idle: false, currentExecutable: { number: 1 } },
            { idle: true }
          ]
        }),
        buildNode({ name: "offline", offline: true, numExecutors: 2, busyExecutors: undefined })
      ],
      [],
      "2026-09-26T12:00:00.000Z"
    );
    assert.equal(model.summary.idleExecutors, 2);
    assert.equal(model.summary.busyExecutors, 1);
    assert.equal(model.summary.offlineExecutors, 2);
    // Offline capacity with an empty queue is a warning, not a saturated pool.
    assert.equal(model.pools.find((pool) => pool.kind === "any")?.severity, "warning");
    assert.equal(model.pools.find((pool) => pool.kind === "any")?.label, "Any node");
    assert.equal(model.summary.saturatedPoolCount, 0);
    const nodes = model.pools.find((pool) => pool.kind === "any")?.nodes;
    assert.equal(nodes?.find((node) => node.name === "agent")?.executorSummary, "1/3 busy");
    assert.equal(nodes?.find((node) => node.name === "offline")?.executorSummary, "2 offline");
  });
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

  it("matches nodes against compound Jenkins label expressions", () => {
    const nodes: JenkinsNodeInfo[] = [
      buildNode({
        name: "linux-x86",
        displayName: "linux-x86",
        assignedLabels: [{ name: "linux" }, { name: "x86" }]
      }),
      buildNode({
        name: "linux-arm",
        displayName: "linux-arm",
        assignedLabels: [{ name: "linux" }, { name: "arm64" }]
      })
    ];
    const queueItems: JenkinsQueueItemInfo[] = [
      {
        id: 7,
        name: "queued-expression-job",
        position: 1,
        assignedLabelName: "linux && (x86 || !linux)",
        buildable: true
      }
    ];

    const viewModel = buildNodeCapacityViewModel(
      environment,
      nodes,
      queueItems,
      "2026-06-14T20:00:00.000Z"
    );

    const expressionPool = viewModel.pools.find(
      (pool) => pool.kind === "label" && pool.label === "linux && (x86 || !linux)"
    );
    assert.ok(expressionPool);
    assert.equal(expressionPool.nodes.map((node) => node.name).join(","), "linux-x86");
    assert.equal(expressionPool.idleExecutors, 1);
    assert.equal(expressionPool.queuedCount, 1);
    assert.notEqual(expressionPool.statusLabel, "No idle executors");

    const matchingNode = viewModel.pools
      .find((pool) => pool.kind === "any")
      ?.nodes.find((node) => node.name === "linux-x86");
    assert.equal(matchingNode?.matchingQueueItems.length, 1);
    const otherNode = viewModel.pools
      .find((pool) => pool.kind === "any")
      ?.nodes.find((node) => node.name === "linux-arm");
    assert.equal(otherNode?.matchingQueueItems.length, 0);
  });

  it.each(["linux", "(linux)", "((linux))"])(
    "matches queue work and capacity for a single-label expression: %s",
    (assignedLabelName) => {
      const model = buildNodeCapacityViewModel(
        environment,
        [
          buildNode({ assignedLabels: [{ name: "linux" }], numExecutors: 3, busyExecutors: 1 }),
          buildNode({ name: "windows-agent", assignedLabels: [{ name: "windows" }] })
        ],
        [{ id: 7, name: "queued-job", position: 1, assignedLabelName, buildable: true }],
        "2026-06-14T20:00:00.000Z"
      );

      const pool = model.pools.find((pool) => pool.label === assignedLabelName);
      assert.ok(pool);
      assert.deepEqual(
        pool.nodes.map((node) => node.name),
        ["agent"]
      );
      assert.equal(pool.totalExecutors, 3);
      assert.equal(pool.idleExecutors, 2);
      assert.equal(pool.queuedCount, 1);
      assert.equal(pool.statusLabel, "Queue pressure");

      const anyPool = model.pools.find((pool) => pool.kind === "any");
      assert.deepEqual(
        anyPool?.nodes
          .find((node) => node.name === "agent")
          ?.matchingQueueItems.map((item) => item.id),
        [7]
      );
      assert.deepEqual(
        anyPool?.nodes.find((node) => node.name === "windows-agent")?.matchingQueueItems,
        []
      );
    }
  );

  it.each(["linux", "(linux)", "linux && !windows"])(
    "keeps differently cased labels separate when scheduling %s",
    (assignedLabelName) => {
      const model = buildNodeCapacityViewModel(
        environment,
        [buildNode({ assignedLabels: [{ name: "Linux" }] })],
        [{ id: 7, name: "queued-job", position: 1, assignedLabelName, buildable: true }],
        "2026-06-14T20:00:00.000Z"
      );

      const linuxPool = model.pools.find((pool) => pool.label === "Linux");
      assert.ok(linuxPool);
      assert.equal(linuxPool.idleExecutors, 1);
      assert.equal(linuxPool.queuedCount, 0);
      assert.deepEqual(linuxPool.nodes[0]?.matchingQueueItems, []);

      const queuedPool = model.pools.find((pool) => pool.label === assignedLabelName);
      assert.ok(queuedPool);
      assert.deepEqual(queuedPool.nodes, []);
      assert.equal(queuedPool.idleExecutors, 0);
      assert.equal(queuedPool.queuedCount, 1);
      assert.equal(queuedPool.statusLabel, "No idle executors");
    }
  );

  it("parses each queued label once per snapshot regardless of node count", () => {
    const queuedLabels = [
      "linux",
      "windows",
      "linux && x86",
      "linux &&",
      "linux && x86",
      "windows"
    ];
    const queueItems = queuedLabels.map((assignedLabelName, index) => ({
      id: index + 1,
      name: `job-${index}`,
      position: index + 1,
      assignedLabelName
    }));
    const parse = vi.spyOn(NodeLabelExpression, "parseCompoundLabelExpression");
    try {
      for (const nodeCount of [1, 8]) {
        parse.mockClear();
        const nodes = Array.from({ length: nodeCount }, (_, index) =>
          buildNode({
            name: `agent-${index}`,
            assignedLabels:
              index % 2 === 0 ? [{ name: "linux" }, { name: "x86" }] : [{ name: "linux" }]
          })
        );
        const model = buildNodeCapacityViewModel(
          environment,
          nodes,
          queueItems,
          "2026-06-14T20:00:00.000Z"
        );

        for (const label of new Set(queuedLabels)) {
          assert.equal(parse.mock.calls.filter(([value]) => value === label).length, 1);
        }
        // The only additional pool label is x86, which is not in the queue.
        assert.equal(parse.mock.calls.length, 5);
        const anyPool = model.pools.find((pool) => pool.kind === "any");
        assert.ok(anyPool);
        for (const [index, node] of anyPool.nodes.entries()) {
          assert.deepEqual(
            node.matchingQueueItems.map((item) => item.id),
            index % 2 === 0 ? [1, 3, 5] : [1]
          );
        }
        assert.equal(model.pools.find((pool) => pool.label === "linux")?.nodes.length, nodeCount);
        assert.equal(
          model.pools.find((pool) => pool.label === "linux && x86")?.nodes.length,
          Math.ceil(nodeCount / 2)
        );
        assert.equal(model.pools.find((pool) => pool.label === "windows")?.nodes.length, 0);
        assert.equal(model.pools.find((pool) => pool.label === "linux &&")?.nodes.length, 0);
      }
    } finally {
      parse.mockRestore();
    }
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

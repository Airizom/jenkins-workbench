import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacityViewModel
} from "../src/shared/nodeCapacity/NodeCapacityContracts";
import { createEmptyNodeCapacitySummary } from "../src/shared/nodeCapacity/NodeCapacityDefaults";
import {
  NODE_CAPACITY_STALE_AFTER_MS,
  type NodeCapacityState,
  buildInitialState,
  isStaleCapacityTimestamp,
  nodeCapacityReducer
} from "../src/panels/nodeCapacity/webview/state/nodeCapacityState";

function buildNode(
  nodeUrl: string,
  overrides?: Partial<NodeCapacityNodeViewModel>
): NodeCapacityNodeViewModel {
  return {
    displayName: nodeUrl,
    name: nodeUrl,
    nodeUrl,
    statusLabel: "Online",
    isOffline: false,
    isTemporarilyOffline: false,
    labels: [],
    poolLabels: [],
    hiddenLabels: [],
    totalExecutors: 2,
    busyExecutors: 1,
    idleExecutors: 1,
    offlineExecutors: 0,
    executorSummary: "1/2 busy",
    executorsLoaded: false,
    executors: [],
    matchingQueueItems: [],
    anyQueueItems: [],
    selfLabelQueueItems: [],
    ...overrides
  };
}

function buildPool(
  id: string,
  nodes: NodeCapacityNodeViewModel[],
  overrides?: Partial<NodeCapacityPoolViewModel>
): NodeCapacityPoolViewModel {
  return {
    id,
    label: id,
    kind: "label",
    severity: "normal",
    statusLabel: "Available",
    nodes,
    queueItems: [],
    offlineImpact: [],
    totalNodes: nodes.length,
    onlineNodes: nodes.length,
    offlineNodes: 0,
    totalExecutors: 2,
    busyExecutors: 1,
    idleExecutors: 1,
    offlineExecutors: 0,
    queuedCount: 0,
    stuckCount: 0,
    blockedCount: 0,
    buildableCount: 0,
    ...overrides
  };
}

function buildViewModel(
  pools: NodeCapacityPoolViewModel[],
  updatedAt: string
): NodeCapacityViewModel {
  return {
    environmentLabel: "Jenkins",
    updatedAt,
    summary: createEmptyNodeCapacitySummary(),
    pools,
    hiddenLabelQueueItems: [],
    errors: [],
    loading: false
  };
}

const EXECUTORS: NodeCapacityExecutorViewModel[] = [
  { id: "0", statusLabel: "Building example #4", isIdle: false, workLabel: "example #4" }
];

function findNode(state: NodeCapacityState, poolId: string, nodeUrl: string) {
  const pool = state.pools.find((candidate) => candidate.id === poolId);
  return pool?.nodes.find((candidate) => candidate.nodeUrl === nodeUrl);
}

describe("nodeCapacityReducer", () => {
  it("hydrates executors for matching nodes", () => {
    const initial = buildInitialState(
      buildViewModel(
        [buildPool("pool:label:linux", [buildNode("https://jenkins.example/computer/a/")])],
        "2026-06-11T00:00:00.000Z"
      )
    );

    const hydrated = nodeCapacityReducer(initial, {
      type: "updateNodeCapacityNodeExecutors",
      payload: [{ nodeUrl: "https://jenkins.example/computer/a/", executors: EXECUTORS }]
    });

    const node = findNode(hydrated, "pool:label:linux", "https://jenkins.example/computer/a/");
    assert.equal(node?.executorsLoaded, true);
    assert.deepEqual(node?.executors, EXECUTORS);
  });

  it("carries hydrated executors across full updates instead of wiping them", () => {
    const initial = buildInitialState(
      buildViewModel(
        [
          buildPool("pool:label:linux", [
            buildNode("https://jenkins.example/computer/a/", {
              executorsLoaded: true,
              executors: EXECUTORS
            }),
            buildNode("https://jenkins.example/computer/b/")
          ])
        ],
        "2026-06-11T00:00:00.000Z"
      )
    );

    // The host rebuilds every node with executorsLoaded: false on each refresh.
    const refreshed = nodeCapacityReducer(initial, {
      type: "updateNodeCapacity",
      payload: buildViewModel(
        [
          buildPool("pool:label:linux", [
            buildNode("https://jenkins.example/computer/a/"),
            buildNode("https://jenkins.example/computer/b/")
          ])
        ],
        "2026-06-11T00:00:10.000Z"
      )
    });

    const carried = findNode(refreshed, "pool:label:linux", "https://jenkins.example/computer/a/");
    assert.equal(carried?.executorsLoaded, true);
    assert.deepEqual(carried?.executors, EXECUTORS);

    const untouched = findNode(
      refreshed,
      "pool:label:linux",
      "https://jenkins.example/computer/b/"
    );
    assert.equal(untouched?.executorsLoaded, false);
    assert.deepEqual(untouched?.executors, []);
    assert.equal(refreshed.updatedAt, "2026-06-11T00:00:10.000Z");
  });

  it("lets fresh executor data replace carried-over executors", () => {
    const initial = buildInitialState(
      buildViewModel(
        [
          buildPool("pool:label:linux", [
            buildNode("https://jenkins.example/computer/a/", {
              executorsLoaded: true,
              executors: EXECUTORS
            })
          ])
        ],
        "2026-06-11T00:00:00.000Z"
      )
    );

    const refreshed = nodeCapacityReducer(initial, {
      type: "updateNodeCapacity",
      payload: buildViewModel(
        [buildPool("pool:label:linux", [buildNode("https://jenkins.example/computer/a/")])],
        "2026-06-11T00:00:10.000Z"
      )
    });

    const freshExecutors: NodeCapacityExecutorViewModel[] = [
      { id: "0", statusLabel: "Idle", isIdle: true }
    ];
    const rehydrated = nodeCapacityReducer(refreshed, {
      type: "updateNodeCapacityNodeExecutors",
      payload: [{ nodeUrl: "https://jenkins.example/computer/a/", executors: freshExecutors }]
    });

    const node = findNode(rehydrated, "pool:label:linux", "https://jenkins.example/computer/a/");
    assert.equal(node?.executorsLoaded, true);
    assert.deepEqual(node?.executors, freshExecutors);
  });

  it("does not carry executors onto nodes the update already hydrated", () => {
    const initial = buildInitialState(
      buildViewModel(
        [
          buildPool("pool:label:linux", [
            buildNode("https://jenkins.example/computer/a/", {
              executorsLoaded: true,
              executors: EXECUTORS
            })
          ])
        ],
        "2026-06-11T00:00:00.000Z"
      )
    );

    const freshExecutors: NodeCapacityExecutorViewModel[] = [
      { id: "1", statusLabel: "Idle", isIdle: true }
    ];
    const refreshed = nodeCapacityReducer(initial, {
      type: "updateNodeCapacity",
      payload: buildViewModel(
        [
          buildPool("pool:label:linux", [
            buildNode("https://jenkins.example/computer/a/", {
              executorsLoaded: true,
              executors: freshExecutors
            })
          ])
        ],
        "2026-06-11T00:00:10.000Z"
      )
    });

    const node = findNode(refreshed, "pool:label:linux", "https://jenkins.example/computer/a/");
    assert.deepEqual(node?.executors, freshExecutors);
  });
});

describe("isStaleCapacityTimestamp", () => {
  const updatedAt = "2026-06-11T00:00:00.000Z";
  const updatedAtMs = Date.parse(updatedAt);

  it("is fresh while the data age is within the stale window", () => {
    assert.equal(isStaleCapacityTimestamp(updatedAt, updatedAtMs), false);
    assert.equal(
      isStaleCapacityTimestamp(updatedAt, updatedAtMs + NODE_CAPACITY_STALE_AFTER_MS),
      false
    );
  });

  it("is stale once the data age exceeds the stale window", () => {
    assert.equal(
      isStaleCapacityTimestamp(updatedAt, updatedAtMs + NODE_CAPACITY_STALE_AFTER_MS + 1),
      true
    );
  });

  it("never marks missing, invalid, or fallback timestamps as stale", () => {
    const now = Date.parse("2026-06-11T12:00:00.000Z");
    assert.equal(isStaleCapacityTimestamp(undefined, now), false);
    assert.equal(isStaleCapacityTimestamp("not-a-date", now), false);
    assert.equal(isStaleCapacityTimestamp("1970-01-01T00:00:00.000Z", now), false);
  });
});

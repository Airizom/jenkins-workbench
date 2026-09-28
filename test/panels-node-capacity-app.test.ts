import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { planExecutorLoads } from "../src/panels/nodeCapacity/webview/hooks/useNodeCapacityExecutorLoading";

describe("planExecutorLoads", () => {
  const nodeA = "https://jenkins.example/computer/a/";
  const nodeB = "https://jenkins.example/computer/b/";

  function node(nodeUrl: string, busyExecutors = 1) {
    return {
      nodeUrl,
      isOffline: false,
      isTemporarilyOffline: false,
      busyExecutors,
      totalExecutors: 2
    };
  }

  it("requests each node once, deduplicated and sorted", () => {
    const requested = new Map<string, string>();

    assert.deepEqual(
      planExecutorLoads([node(nodeB), node(nodeA), node(nodeA)], requested, 0, "t1"),
      [nodeA, nodeB]
    );
    assert.deepEqual(planExecutorLoads([node(nodeA), node(nodeB)], requested, 0, "t1"), []);
  });

  it("does not re-request unchanged idle nodes on periodic snapshots", () => {
    const requested = new Map<string, string>();
    planExecutorLoads([node(nodeA, 0), node(nodeB, 0)], requested, 0, "t1");

    // A new capacity snapshot rebuilds node objects with the same counts.
    assert.deepEqual(
      planExecutorLoads([{ ...node(nodeA, 0) }, { ...node(nodeB, 0) }], requested, 0, "t2"),
      []
    );
  });

  it("re-requests busy nodes on each new snapshot, since builds turn over at constant counts", () => {
    const requested = new Map<string, string>();
    planExecutorLoads([node(nodeA), node(nodeB, 0)], requested, 0, "t1");

    assert.deepEqual(planExecutorLoads([node(nodeA), node(nodeB, 0)], requested, 0, "t2"), [nodeA]);
    // Re-planning within the same snapshot (e.g. a pool toggle) does not re-request.
    assert.deepEqual(planExecutorLoads([node(nodeA), node(nodeB, 0)], requested, 0, "t2"), []);
  });

  it("re-requests a node whose executor counts changed", () => {
    const requested = new Map<string, string>();
    planExecutorLoads([node(nodeA), node(nodeB)], requested, 0, "t1");

    assert.deepEqual(planExecutorLoads([node(nodeA, 2), node(nodeB)], requested, 0, "t1"), [nodeA]);
  });

  it("re-requests every expanded node after a manual refresh", () => {
    const requested = new Map<string, string>();
    planExecutorLoads([node(nodeA), node(nodeB)], requested, 0, "t1");

    assert.deepEqual(planExecutorLoads([node(nodeA), node(nodeB)], requested, 1, "t1"), [
      nodeA,
      nodeB
    ]);
  });

  it("skips nodes without a URL", () => {
    assert.deepEqual(
      planExecutorLoads([{ ...node(nodeA), nodeUrl: undefined }], new Map(), 0, "t1"),
      []
    );
  });
});

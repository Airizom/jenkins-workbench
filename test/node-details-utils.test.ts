import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { NodeExecutorViewModel } from "../src/panels/nodeDetails/shared/NodeDetailsContracts";
import {
  formatExecutorCounts,
  formatExecutorName,
  summarizeExecutorUtilization
} from "../src/panels/nodeDetails/webview/components/nodeDetails/executorUtilization";

function makeExecutor(overrides: Partial<NodeExecutorViewModel> = {}): NodeExecutorViewModel {
  return {
    id: "0",
    statusLabel: "Idle",
    isIdle: true,
    ...overrides
  };
}

describe("summarizeExecutorUtilization", () => {
  it("returns an undefined ratio when there are no executors", () => {
    const utilization = summarizeExecutorUtilization([], []);

    assert.equal(utilization.total, 0);
    assert.equal(utilization.busy, 0);
    assert.equal(utilization.idle, 0);
    assert.equal(utilization.ratio, undefined);
  });

  it("counts busy and idle executors via the isIdle flag", () => {
    const utilization = summarizeExecutorUtilization(
      [
        makeExecutor({ id: "0", isIdle: false, statusLabel: "Busy", workLabel: "job #12" }),
        makeExecutor({ id: "1" }),
        makeExecutor({ id: "2", isIdle: false, statusLabel: "Busy" })
      ],
      []
    );

    assert.equal(utilization.total, 3);
    assert.equal(utilization.busy, 2);
    assert.equal(utilization.idle, 1);
    assert.equal(utilization.ratio, 2 / 3);
  });

  it("tracks one-off executors separately from the ratio", () => {
    const utilization = summarizeExecutorUtilization(
      [makeExecutor({ id: "0" })],
      [
        makeExecutor({ id: "oneoff-0", isIdle: false, statusLabel: "Busy" }),
        makeExecutor({ id: "oneoff-1" })
      ]
    );

    assert.equal(utilization.oneOffTotal, 2);
    assert.equal(utilization.oneOffBusy, 1);
    assert.equal(utilization.ratio, 0);
  });

  it("keeps the ratio within [0, 1] for all-busy nodes", () => {
    const utilization = summarizeExecutorUtilization(
      [makeExecutor({ id: "0", isIdle: false }), makeExecutor({ id: "1", isIdle: false })],
      []
    );

    assert.equal(utilization.ratio, 1);
  });
});

describe("offline executor utilization", () => {
  it("reports free executors on an offline node as offline, not idle", () => {
    const utilization = summarizeExecutorUtilization(
      [makeExecutor({ id: "0" }), makeExecutor({ id: "1" }), makeExecutor({ id: "2" })],
      [],
      true
    );

    assert.equal(utilization.idle, 0);
    assert.equal(utilization.offline, 3);
    assert.equal(formatExecutorCounts(utilization), "3 offline");
  });

  it("keeps draining builds visible next to the offline count", () => {
    const utilization = summarizeExecutorUtilization(
      [makeExecutor({ id: "0", isIdle: false }), makeExecutor({ id: "1" })],
      [],
      true
    );

    assert.equal(formatExecutorCounts(utilization), "1 busy · 1 offline");
  });

  it("formats online nodes as busy and idle counts", () => {
    const utilization = summarizeExecutorUtilization(
      [makeExecutor({ id: "0", isIdle: false }), makeExecutor({ id: "1" })],
      []
    );

    assert.equal(utilization.offline, 0);
    assert.equal(formatExecutorCounts(utilization), "1 busy · 1 idle");
  });
});

describe("formatExecutorName", () => {
  it("prefixes numeric executor ids and keeps fallback labels", () => {
    assert.equal(formatExecutorName("#2"), "Executor #2");
    assert.equal(formatExecutorName("3"), "Executor #3");
    assert.equal(formatExecutorName("One-off 1"), "One-off 1");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { NodeDetailsViewModel } from "../src/panels/nodeDetails/shared/NodeDetailsContracts";
import {
  isNodeDetailsViewModel,
  parseNodeDetailsOutgoingMessage
} from "../src/panels/nodeDetails/shared/NodeDetailsPanelMessages";

function createNodeDetailsViewModel(
  overrides: Partial<Record<keyof NodeDetailsViewModel, unknown>> = {}
): Record<string, unknown> {
  return {
    detailsAvailable: true,
    displayName: "agent-1",
    name: "agent-1",
    description: "Linux agent",
    url: "https://jenkins.example.com/computer/agent-1/",
    updatedAt: "2026-09-23T00:00:00.000Z",
    statusLabel: "Online",
    statusClass: "online",
    isOffline: false,
    isTemporarilyOffline: false,
    canTakeOffline: true,
    canBringOnline: false,
    canLaunchAgent: false,
    canOpenAgentInstructions: false,
    activityLabel: "Idle",
    executorsLabel: "0 of 2 busy",
    labels: ["linux"],
    executors: [{ id: "0", statusLabel: "Idle", isIdle: true }],
    oneOffExecutors: [],
    queuedWork: {
      matchingQueueItems: [],
      anyQueueItems: [],
      selfLabelQueueItems: []
    },
    monitorData: [{ key: "disk", summary: "10 GB", raw: { free: 10 } }],
    loadStatistics: [],
    rawJson: "{}",
    errors: [],
    advancedLoaded: false,
    ...overrides
  };
}

describe("NodeDetailsPanelMessages", () => {
  it("accepts update messages with a valid payload", () => {
    const payload = createNodeDetailsViewModel();
    const parsed = parseNodeDetailsOutgoingMessage({ type: "updateNodeDetails", payload });

    assert.deepEqual(parsed, { type: "updateNodeDetails", payload });
    assert.ok(parsed && parsed.type === "updateNodeDetails");
    assert.equal(parsed.payload, payload);
  });

  it("rejects update messages without a payload record", () => {
    for (const payload of [undefined, null, "agent-1", 42, [createNodeDetailsViewModel()]]) {
      assert.equal(
        parseNodeDetailsOutgoingMessage({ type: "updateNodeDetails", payload }),
        undefined
      );
    }
    assert.equal(parseNodeDetailsOutgoingMessage({ type: "updateNodeDetails" }), undefined);
  });

  it("rejects each malformed payload field independently", () => {
    const invalidPayloads: Record<string, unknown>[] = [
      createNodeDetailsViewModel({ displayName: undefined }),
      createNodeDetailsViewModel({ name: 7 }),
      createNodeDetailsViewModel({ updatedAt: null }),
      createNodeDetailsViewModel({ statusLabel: undefined }),
      createNodeDetailsViewModel({ statusClass: "bogus" }),
      createNodeDetailsViewModel({ description: 3 }),
      createNodeDetailsViewModel({ offlineReason: false }),
      createNodeDetailsViewModel({ isOffline: "false" }),
      createNodeDetailsViewModel({ canTakeOffline: undefined }),
      createNodeDetailsViewModel({ advancedLoaded: 1 }),
      createNodeDetailsViewModel({ activityLabel: undefined }),
      createNodeDetailsViewModel({ detailsAvailable: undefined }),
      createNodeDetailsViewModel({ executorsLabel: undefined }),
      createNodeDetailsViewModel({ rawJson: undefined }),
      createNodeDetailsViewModel({ labels: "linux" }),
      createNodeDetailsViewModel({ labels: [1] }),
      createNodeDetailsViewModel({ errors: undefined }),
      createNodeDetailsViewModel({ executors: undefined }),
      createNodeDetailsViewModel({ executors: [{ id: 0, statusLabel: "Idle", isIdle: true }] }),
      createNodeDetailsViewModel({ oneOffExecutors: [null] }),
      createNodeDetailsViewModel({ monitorData: [{ key: "disk" }] }),
      createNodeDetailsViewModel({ loadStatistics: {} }),
      createNodeDetailsViewModel({ queuedWork: undefined }),
      createNodeDetailsViewModel({ queuedWork: { matchingQueueItems: [] } }),
      createNodeDetailsViewModel({
        queuedWork: { matchingQueueItems: [], anyQueueItems: "none", selfLabelQueueItems: [] }
      })
    ];

    for (const payload of invalidPayloads) {
      assert.equal(isNodeDetailsViewModel(payload), false);
      assert.equal(
        parseNodeDetailsOutgoingMessage({ type: "updateNodeDetails", payload }),
        undefined
      );
    }
  });

  it("accepts payloads that omit optional string fields", () => {
    const payload = createNodeDetailsViewModel({
      description: undefined,
      url: undefined,
      offlineReason: undefined,
      jnlpAgentLabel: undefined,
      launchSupportedLabel: undefined,
      manualLaunchLabel: undefined
    });

    assert.equal(isNodeDetailsViewModel(payload), true);
  });

  it("parses copy result messages only with a boolean success flag", () => {
    for (const success of [true, false]) {
      assert.deepEqual(parseNodeDetailsOutgoingMessage({ type: "copyNodeJsonResult", success }), {
        type: "copyNodeJsonResult",
        success
      });
    }
    for (const success of [undefined, null, "true", 1]) {
      assert.equal(
        parseNodeDetailsOutgoingMessage({ type: "copyNodeJsonResult", success }),
        undefined
      );
    }
  });

  it("still parses setLoading messages and rejects unknown types", () => {
    assert.deepEqual(parseNodeDetailsOutgoingMessage({ type: "setLoading", value: true }), {
      type: "setLoading",
      value: true
    });
    for (const message of [undefined, null, "updateNodeDetails", 42, { type: "refresh" }]) {
      assert.equal(parseNodeDetailsOutgoingMessage(message), undefined);
    }
  });
});

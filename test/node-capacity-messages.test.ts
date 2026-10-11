import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  isLoadNodeCapacityExecutorsMessage,
  isOpenNodeDetailsMessage,
  parseNodeCapacityOutgoingMessage
} from "../src/panels/nodeCapacity/shared/NodeCapacityPanelMessages";

describe("NodeCapacityPanelMessages", () => {
  it("rejects malformed load executor messages without throwing", () => {
    const invalidMessages: unknown[] = [
      null,
      undefined,
      "loadNodeCapacityExecutors",
      1,
      true,
      { type: "loadNodeCapacityExecutors" },
      { type: "loadNodeCapacityExecutors", nodeUrls: "https://jenkins.example/node/a" },
      { type: "loadNodeCapacityExecutors", nodeUrls: ["https://jenkins.example/node/a", 1] },
      { type: "loadNodeCapacityExecutors", nodeUrls: [], requestId: -1 },
      { type: "other", nodeUrls: ["https://jenkins.example/node/a"] }
    ];

    for (const message of invalidMessages) {
      assert.equal(isLoadNodeCapacityExecutorsMessage(message), false);
    }
  });

  it("accepts load executor messages with string node URLs", () => {
    assert.equal(
      isLoadNodeCapacityExecutorsMessage({
        type: "loadNodeCapacityExecutors",
        requestId: 0,
        nodeUrls: ["https://jenkins.example/node/a", "https://jenkins.example/node/b"]
      }),
      true
    );
  });

  it("rejects outgoing update messages with malformed payloads", () => {
    const invalidMessages: unknown[] = [
      { type: "updateNodeCapacityNodeExecutors" },
      { type: "updateNodeCapacityNodeExecutors", requestId: 1 },
      { type: "updateNodeCapacityNodeExecutors", requestId: "1", payload: [] },
      { type: "updateNodeCapacityNodeExecutors", requestId: 1, payload: [{ nodeUrl: 1 }] },
      { type: "updateNodeCapacityNodeExecutors", requestId: 1, payload: [{ nodeUrl: "a" }] },
      { type: "updateNodeCapacity" },
      { type: "updateNodeCapacity", payload: { pools: [] } }
    ];

    for (const message of invalidMessages) {
      assert.equal(parseNodeCapacityOutgoingMessage(message), undefined);
    }
  });

  it("accepts well-formed outgoing update messages", () => {
    const executors = {
      type: "updateNodeCapacityNodeExecutors",
      requestId: 3,
      payload: [
        { nodeUrl: "https://jenkins.example/node/a", executors: [] },
        { nodeUrl: "https://jenkins.example/node/b", error: "boom" }
      ]
    };
    assert.equal(parseNodeCapacityOutgoingMessage(executors), executors);

    const update = {
      type: "updateNodeCapacity",
      payload: { summary: {}, pools: [], hiddenLabelQueueItems: [], errors: [] }
    };
    assert.equal(parseNodeCapacityOutgoingMessage(update), update);
  });

  it("rejects open node details messages with a non-string label", () => {
    assert.equal(
      isOpenNodeDetailsMessage({ type: "openNodeDetails", nodeUrl: "x", label: 5 }),
      false
    );
    assert.equal(isOpenNodeDetailsMessage({ type: "openNodeDetails", nodeUrl: "x" }), true);
    assert.equal(
      isOpenNodeDetailsMessage({ type: "openNodeDetails", nodeUrl: "x", label: "Node" }),
      true
    );
  });
});

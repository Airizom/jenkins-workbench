import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLoadNodeCapacityExecutorsMessage } from "../src/panels/nodeCapacity/shared/NodeCapacityPanelMessages";

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
        nodeUrls: ["https://jenkins.example/node/a", "https://jenkins.example/node/b"]
      }),
      true
    );
  });
});

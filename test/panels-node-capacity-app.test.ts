import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { NodeCapacityIncomingMessage } from "../src/panels/nodeCapacity/shared/NodeCapacityPanelMessages";
import { postLoadExecutorsIfChanged } from "../src/panels/nodeCapacity/webview/NodeCapacityApp";

describe("postLoadExecutorsIfChanged", () => {
  const updatedAt = "2026-06-11T00:00:00.000Z";
  const nodeA = "https://jenkins.example/computer/a/";
  const nodeB = "https://jenkins.example/computer/b/";

  it("posts deduplicated URLs, suppresses equivalent requests, and permits refreshes", () => {
    const postMessage = vi.fn<(message: NodeCapacityIncomingMessage) => void>();
    const lastRequestKey: { current: string | undefined } = { current: undefined };

    postLoadExecutorsIfChanged(postMessage, lastRequestKey, updatedAt, [nodeB, nodeA, nodeA]);
    postLoadExecutorsIfChanged(postMessage, lastRequestKey, updatedAt, [nodeA, nodeB]);

    assert.deepEqual(postMessage.mock.calls, [
      [
        {
          type: "loadNodeCapacityExecutors",
          nodeUrls: [nodeA, nodeB]
        }
      ]
    ]);

    postLoadExecutorsIfChanged(postMessage, lastRequestKey, "2026-06-11T00:00:10.000Z", [
      nodeA,
      nodeB
    ]);

    assert.equal(postMessage.mock.calls.length, 2);
  });
});

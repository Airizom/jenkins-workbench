import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { NodeCapacityIncomingMessage } from "../src/panels/nodeCapacity/shared/NodeCapacityPanelMessages";
import {
  createExecutorLoadRequestKey,
  postLoadExecutorsIfChanged
} from "../src/panels/nodeCapacity/webview/NodeCapacityApp";

describe("createExecutorLoadRequestKey", () => {
  const updatedAt = "2026-06-11T00:00:00.000Z";
  const nodeA = "https://jenkins.example/computer/a/";
  const nodeB = "https://jenkins.example/computer/b/";

  it("is stable for the same normalized node URL set", () => {
    const requestKey = createExecutorLoadRequestKey(updatedAt, [nodeA, nodeB]);

    assert.equal(createExecutorLoadRequestKey(updatedAt, [nodeB, nodeA, nodeA]), requestKey);
  });

  it("changes when the capacity refresh timestamp changes", () => {
    const requestKey = createExecutorLoadRequestKey(updatedAt, [nodeA]);

    assert.notEqual(createExecutorLoadRequestKey("2026-06-11T00:00:10.000Z", [nodeA]), requestKey);
  });

  it("changes when the expanded node URL set changes", () => {
    const requestKey = createExecutorLoadRequestKey(updatedAt, [nodeA]);

    assert.notEqual(createExecutorLoadRequestKey(updatedAt, [nodeA, nodeB]), requestKey);
  });

  it("suppresses executor-response loops and permits one request after a refresh", () => {
    const postMessage = vi.fn<(message: NodeCapacityIncomingMessage) => void>();
    const lastRequestKey: { current: string | undefined } = { current: undefined };

    postLoadExecutorsIfChanged(postMessage, lastRequestKey, updatedAt, [nodeB, nodeA, nodeA]);
    postLoadExecutorsIfChanged(postMessage, lastRequestKey, updatedAt, [nodeA, nodeB]);

    assert.deepEqual(postMessage.mock.calls, [
      [
        {
          type: "loadNodeCapacityExecutors",
          nodeUrls: [nodeB, nodeA]
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

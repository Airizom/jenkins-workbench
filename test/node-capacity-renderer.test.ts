import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

vi.doMock("vscode", () => ({}));
const { nodeCapacityWebviewEntryName } = await import(
  "../src/panels/nodeCapacity/NodeCapacityRenderer"
);

describe("NodeCapacityRenderer", () => {
  it("declares the node capacity webview manifest entry", () => {
    assert.equal(nodeCapacityWebviewEntryName, "nodeCapacity");
  });
});

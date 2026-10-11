import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { classifyNodeLabels } from "../src/services/NodeLabelClassification";
import {
  buildNodeQueuedWorkViewModel,
  buildQueueWorkItems
} from "../src/services/QueueWorkViewModel";

describe("QueueWorkViewModel label identity", () => {
  it("distinguishes self labels from pool labels that differ only by case", () => {
    const labels = classifyNodeLabels({
      name: "Linux",
      displayName: "Linux",
      assignedLabels: [{ name: "Linux" }, { name: "linux" }]
    });
    const items = buildQueueWorkItems([
      { id: 1, name: "self", position: 1, assignedLabelName: "Linux" },
      { id: 2, name: "pool", position: 2, assignedLabelName: "linux" },
      { id: 3, name: "unmatched", position: 3, assignedLabelName: "LINUX" }
    ]);
    const model = buildNodeQueuedWorkViewModel(items, labels);

    assert.deepEqual(labels.hiddenLabels, ["Linux"]);
    assert.deepEqual(labels.poolLabels, ["linux"]);
    assert.deepEqual(
      model.selfLabelQueueItems.map((item) => item.id),
      [1]
    );
    assert.deepEqual(
      model.matchingQueueItems.map((item) => item.id),
      [2]
    );
  });

  it("preserves inferred label case while looking up node names case-insensitively", () => {
    const items = buildQueueWorkItems(
      [{ id: 1, name: "blocked", position: 1, reason: "'AGENT' is offline" }],
      {
        nodes: [
          {
            name: "agent",
            displayName: "Agent",
            assignedLabels: [{ name: "agent" }, { name: "Linux" }, { name: "linux" }]
          }
        ]
      }
    );

    assert.deepEqual(items[0]?.queuedForLabels, ["Linux", "linux"]);
  });
});

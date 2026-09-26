import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NodeCapacityPanel } from "../src/panels/NodeCapacityPanel";
import { PanelLoadTracker } from "../src/panels/shared/PanelRuntimeHelpers";
import type { NodeCapacityOutgoingMessage } from "../src/panels/nodeCapacity/shared/NodeCapacityPanelMessages";
import { createEmptyNodeCapacitySummary } from "../src/shared/nodeCapacity/NodeCapacityDefaults";
import type { NodeCapacityNodeExecutorsUpdateMessage } from "../src/shared/nodeCapacity/NodeCapacityContracts";

describe("NodeCapacityPanel", () => {
  it("delivers executor hydration when a capacity refresh completes first", async () => {
    const environment = {
      environmentId: "jenkins",
      scope: "global" as const,
      url: "https://jenkins.example/"
    };
    const nodeUrl = "https://jenkins.example/computer/agent/";
    const entries: NodeCapacityNodeExecutorsUpdateMessage["payload"] = [{ nodeUrl, executors: [] }];
    let resolveHydration!: (value: typeof entries) => void;
    const messages: NodeCapacityOutgoingMessage[] = [];
    const panel = Object.create(NodeCapacityPanel.prototype) as NodeCapacityPanel;
    Object.assign(panel, {
      capacityService: {
        getNodeCapacity: async () => ({
          environmentLabel: "Jenkins",
          updatedAt: "2026-09-22T00:00:00.000Z",
          summary: createEmptyNodeCapacitySummary(),
          pools: [],
          hiddenLabelQueueItems: [],
          errors: [],
          loading: false
        }),
        hydrateNodeExecutors: () =>
          new Promise<typeof entries>((resolve) => {
            resolveHydration = resolve;
          })
      },
      environment,
      executorLoadGeneration: 1,
      capacityRequestCount: 0,
      hasRendered: true,
      disposed: false,
      loadTracker: new PanelLoadTracker(() => {}),
      panel: {
        webview: {
          postMessage: (message: NodeCapacityOutgoingMessage) => {
            messages.push(message);
            return Promise.resolve(true);
          }
        }
      }
    });

    const loadExecutors = Reflect.get(panel, "loadNodeExecutors") as (
      this: NodeCapacityPanel,
      nodeUrls: string[],
      snapshotGeneration: number
    ) => Promise<void>;
    const refreshCapacity = Reflect.get(panel, "refreshCapacity") as (
      this: NodeCapacityPanel
    ) => Promise<void>;

    const hydration = loadExecutors.call(panel, [nodeUrl], 1);
    await refreshCapacity.call(panel);
    resolveHydration(entries);
    await hydration;

    assert.deepEqual(
      messages.filter((message) => message.type === "updateNodeCapacityNodeExecutors"),
      [{ type: "updateNodeCapacityNodeExecutors", snapshotGeneration: 1, payload: entries }]
    );
  });
});

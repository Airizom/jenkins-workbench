import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { NodeCapacityPanel } from "../src/panels/NodeCapacityPanel";
import { NodeCapacityService } from "../src/services/NodeCapacityService";
import { LoadTokenTracker, PanelLoadTracker } from "../src/panels/shared/PanelRuntimeHelpers";
import type { NodeCapacityOutgoingMessage } from "../src/panels/nodeCapacity/shared/NodeCapacityPanelMessages";
import { createEmptyNodeCapacitySummary } from "../src/shared/nodeCapacity/NodeCapacityDefaults";
import type { NodeCapacityNodeExecutorsUpdateMessage } from "../src/shared/nodeCapacity/NodeCapacityContracts";

describe("NodeCapacityPanel", () => {
  it("resumes polling after being revealed during an active refresh", async () => {
    vi.useFakeTimers();
    try {
      const model = {
        environmentLabel: "Jenkins",
        updatedAt: "2026-09-22T00:00:00.000Z",
        summary: createEmptyNodeCapacitySummary(),
        pools: [],
        hiddenLabelQueueItems: [],
        errors: [],
        loading: false
      };
      let resolveCapacity!: (value: typeof model) => void;
      const getNodeCapacity = vi
        .fn()
        .mockResolvedValue(model)
        .mockImplementationOnce(
          () =>
            new Promise<typeof model>((resolve) => {
              resolveCapacity = resolve;
            })
        );
      const viewStateListeners: (() => void)[] = [];
      const webviewPanel = {
        visible: true,
        onDidDispose: vi.fn(),
        onDidChangeViewState: (listener: () => void) => {
          viewStateListeners.push(listener);
          return { dispose() {} };
        },
        webview: { postMessage: vi.fn().mockResolvedValue(true) }
      };
      const panel = Object.create(NodeCapacityPanel.prototype) as NodeCapacityPanel;
      Object.assign(panel, {
        capacityService: { getNodeCapacity },
        environment: {
          environmentId: "jenkins",
          scope: "global",
          url: "https://jenkins.example/"
        },
        capacityRequestCount: 0,
        hasRendered: true,
        disposed: false,
        disposables: [],
        loadTokenTracker: new LoadTokenTracker(),
        loadTracker: new PanelLoadTracker(() => {}),
        panel: webviewPanel
      });
      const attachLifecycle = Reflect.get(panel, "attachLifecycle") as (
        this: NodeCapacityPanel
      ) => void;
      attachLifecycle.call(panel);
      const setVisible = (visible: boolean) => {
        webviewPanel.visible = visible;
        for (const listener of viewStateListeners) {
          listener();
        }
      };

      setVisible(true);
      assert.equal(getNodeCapacity.mock.calls.length, 1);
      setVisible(false);
      setVisible(true);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(getNodeCapacity.mock.calls.length, 1);

      resolveCapacity(model);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(9_999);
      assert.equal(getNodeCapacity.mock.calls.length, 1);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(getNodeCapacity.mock.calls.length, 2);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(getNodeCapacity.mock.calls.length, 3);
      setVisible(false);
      await vi.advanceTimersByTimeAsync(10_000);
      assert.equal(getNodeCapacity.mock.calls.length, 3);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

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
      loadTokenTracker: new LoadTokenTracker(),
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
      requestId: number
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
      [{ type: "updateNodeCapacityNodeExecutors", requestId: 1, payload: entries }]
    );
  });

  it("reports a failing node inline without failing the rest of the batch", async () => {
    const environment = {
      environmentId: "jenkins",
      scope: "global" as const,
      url: "https://jenkins.example/"
    };
    const goodNode = "https://jenkins.example/computer/good/";
    const badNode = "https://jenkins.example/computer/bad/";
    const service = new NodeCapacityService({
      getNodeDetails: async (_environment: unknown, nodeUrl: string) => {
        if (nodeUrl === badNode) {
          throw new Error("connection reset");
        }
        return { displayName: "good", executors: [], oneOffExecutors: [] };
      }
    } as never);

    const results = await service.hydrateNodeExecutors(environment, [goodNode, badNode]);

    assert.deepEqual(results[0], { nodeUrl: goodNode, executors: [] });
    assert.equal(results[1]?.nodeUrl, badNode);
    assert.match(results[1]?.error ?? "", /connection reset/);
  });

  it("opens in-environment builds in Build Details and falls back to the browser", async () => {
    const environment = {
      environmentId: "jenkins",
      scope: "global" as const,
      url: "https://jenkins.example/"
    };
    const buildUrl = "https://jenkins.example/job/api/7/";
    const show = vi.fn().mockResolvedValue(undefined);
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const panel = Object.create(NodeCapacityPanel.prototype) as NodeCapacityPanel;
    Object.assign(panel, {
      environment,
      buildDetailsPanelLauncher: { show },
      openExternalUrl
    });
    const openBuildDetails = Reflect.get(panel, "openBuildDetails") as (
      this: NodeCapacityPanel,
      buildUrl: string,
      label?: string
    ) => Promise<void>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await openBuildDetails.call(panel, buildUrl, "api #7");
      assert.deepEqual(show.mock.calls, [[{ environment, buildUrl, label: "api #7" }]]);

      await openBuildDetails.call(panel, "https://elsewhere.example/job/api/7/");
      assert.equal(show.mock.calls.length, 1);
      assert.equal(openExternalUrl.mock.calls.length, 0);

      Object.assign(panel, { buildDetailsPanelLauncher: undefined });
      await openBuildDetails.call(panel, buildUrl);
      assert.deepEqual(openExternalUrl.mock.calls, [[buildUrl]]);
    } finally {
      warn.mockRestore();
    }
  });
});

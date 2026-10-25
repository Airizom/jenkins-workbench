import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel
} from "../src/shared/nodeCapacity/NodeCapacityContracts";
import { createEmptyNodeCapacitySummary } from "../src/shared/nodeCapacity/NodeCapacityDefaults";
import type { QueueWorkItemViewModel } from "../src/shared/queueWork/QueueWorkContracts";
import {
  NodeCapacityQueueList,
  PinnedNodeQueue
} from "../src/panels/nodeCapacity/webview/components/NodeCapacityQueue";
import { NodeCapacitySummary } from "../src/panels/nodeCapacity/webview/components/NodeCapacitySummary";
import { collectRenderedNodes } from "../src/panels/nodeCapacity/webview/hooks/useNodeCapacityExecutorLoading";
import {
  buildPinnedNodeIndex,
  filterPinnedQueueItems,
  filterPoolNodes,
  filterPools,
  orderPoolNodes,
  resolveIdleTone,
  resolveQueuedTone,
  resolvePinnedNode
} from "../src/panels/nodeCapacity/webview/state/nodeCapacityView";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

function node(
  name: string,
  overrides: Partial<NodeCapacityNodeViewModel> = {}
): NodeCapacityNodeViewModel {
  return {
    displayName: name,
    name,
    nodeUrl: `https://jenkins.example/computer/${name}/`,
    statusLabel: "Online",
    isOffline: false,
    isTemporarilyOffline: false,
    labels: ["linux", name],
    poolLabels: ["linux"],
    hiddenLabels: [name],
    totalExecutors: 2,
    busyExecutors: 0,
    idleExecutors: 2,
    offlineExecutors: 0,
    executorSummary: "0/2 busy",
    executorsLoaded: false,
    executors: [],
    matchingQueueItems: [],
    anyQueueItems: [],
    selfLabelQueueItems: [],
    ...overrides
  };
}

function queueItem(
  name: string,
  labels: string[],
  overrides: Partial<QueueWorkItemViewModel> = {}
): QueueWorkItemViewModel {
  return {
    id: name.length,
    name,
    position: 1,
    statusLabel: "Waiting",
    queuedForLabels: labels,
    blocked: false,
    buildable: true,
    stuck: false,
    ...overrides
  };
}

function pool(
  label: string,
  overrides: Partial<NodeCapacityPoolViewModel> = {}
): NodeCapacityPoolViewModel {
  return {
    id: `pool:${label}`,
    label,
    kind: "label",
    severity: "normal",
    statusLabel: "Available",
    nodes: [],
    queueItems: [],
    totalNodes: 0,
    onlineNodes: 0,
    offlineNodes: 0,
    totalExecutors: 0,
    busyExecutors: 0,
    idleExecutors: 0,
    offlineExecutors: 0,
    queuedCount: 0,
    stuckCount: 0,
    blockedCount: 0,
    buildableCount: 0,
    ...overrides
  };
}

describe("capacity tones", () => {
  it("escalates queued work the same way as the host's pool severity", () => {
    assert.equal(resolveQueuedTone({ queuedCount: 0, stuckCount: 0, idleExecutors: 0 }), undefined);
    assert.equal(resolveQueuedTone({ queuedCount: 2, stuckCount: 0, idleExecutors: 1 }), "warning");
    assert.equal(resolveQueuedTone({ queuedCount: 2, stuckCount: 1, idleExecutors: 1 }), "failure");
    assert.equal(resolveQueuedTone({ queuedCount: 2, stuckCount: 0, idleExecutors: 0 }), "failure");
    assert.equal(resolveIdleTone({ queuedCount: 2, stuckCount: 0, idleExecutors: 0 }), "failure");
    assert.equal(resolveIdleTone({ queuedCount: 0, stuckCount: 0, idleExecutors: 0 }), undefined);
  });
});

describe("pool filtering", () => {
  const pools = [
    pool("linux", { severity: "critical", nodes: [node("agent-1"), node("agent-2")] }),
    pool("windows", { nodes: [node("win-1")], queueItems: [queueItem("installer", ["windows"])] })
  ];

  it("matches labels, node names, and queued jobs case-insensitively", () => {
    assert.deepEqual(
      filterPools(pools, { query: "LIN", attentionOnly: false }).map((p) => p.label),
      ["linux"]
    );
    assert.deepEqual(
      filterPools(pools, { query: "win-1", attentionOnly: false }).map((p) => p.label),
      ["windows"]
    );
    assert.deepEqual(
      filterPools(pools, { query: "install", attentionOnly: false }).map((p) => p.label),
      ["windows"]
    );
    assert.equal(filterPools(pools, { query: "  ", attentionOnly: false }), pools);
  });

  it("keeps only pools that need attention", () => {
    assert.deepEqual(
      filterPools(pools, { query: "", attentionOnly: true }).map((p) => p.label),
      ["linux"]
    );
  });

  it("narrows a pool's nodes only when the pool matched by node name", () => {
    const linux = pools[0];
    assert.deepEqual(
      filterPoolNodes(linux, "agent-2").map((n) => n.name),
      ["agent-2"]
    );
    assert.equal(filterPoolNodes(linux, "linux"), linux.nodes);
    assert.equal(filterPoolNodes(linux, ""), linux.nodes);
  });

  it("loads executors only for rendered nodes", () => {
    const many = pool("fleet", {
      nodes: Array.from({ length: 15 }, (_, index) => node(`fleet-${index}`))
    });
    const open = new Map([[many.id, true]]);
    assert.equal(collectRenderedNodes([many], open, new Set(), "").length, 10);
    assert.equal(collectRenderedNodes([many], open, new Set([many.id]), "").length, 15);
    assert.deepEqual(
      collectRenderedNodes([many], open, new Set(), "fleet-14").map((n) => n.name),
      ["fleet-14"]
    );
    assert.equal(collectRenderedNodes([many], new Map(), new Set(), "").length, 0);
  });

  it("orders disconnected, then temporarily offline, then online nodes stably", () => {
    const ordered = orderPoolNodes([
      node("a"),
      node("b", { isOffline: true, isTemporarilyOffline: true }),
      node("c"),
      node("d", { isOffline: true })
    ]);
    assert.deepEqual(
      ordered.map((n) => n.name),
      ["d", "b", "a", "c"]
    );
  });
});

describe("pinned queue items", () => {
  const pools = [pool("linux", { nodes: [node("agent-1")] })];

  it("maps a self label back to its node", () => {
    const index = buildPinnedNodeIndex(pools);
    assert.equal(resolvePinnedNode(queueItem("job", ["agent-1"]), index)?.displayName, "agent-1");
    assert.equal(resolvePinnedNode(queueItem("job", ["agent-1", "linux"]), index), undefined);
  });

  it("filters by job or label and keeps only stuck items when attention is requested", () => {
    const items = [
      queueItem("deploy", ["agent-1"]),
      queueItem("flash", ["agent-9"], { stuck: true })
    ];
    assert.deepEqual(
      filterPinnedQueueItems(items, { query: "agent-9", attentionOnly: false }).map((i) => i.name),
      ["flash"]
    );
    assert.deepEqual(
      filterPinnedQueueItems(items, { query: "", attentionOnly: true }).map((i) => i.name),
      ["flash"]
    );
  });

  it("links the pinned node and stays neutral until something is stuck", () => {
    const render = (items: QueueWorkItemViewModel[]) =>
      renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(PinnedNodeQueue, {
            items,
            pinnedNodes: buildPinnedNodeIndex(pools),
            onOpenExternal: () => undefined,
            onOpenNodeDetails: () => undefined
          })
        )
      );

    const waiting = render([queueItem("deploy", ["agent-1"])]);
    assert.match(waiting, /Waiting on a specific node/);
    assert.match(waiting, /title="agent-1 \(open node details\)"/);
    assert.match(waiting, /<span class="sr-only"> build<\/span>/);
    assert.doesNotMatch(waiting, /border-failure-border/);

    const stuck = render([queueItem("deploy", ["agent-1"], { stuck: true, statusLabel: "Stuck" })]);
    assert.match(stuck, /border-failure-border/);
    assert.match(stuck, /1 stuck/);
  });
});

describe("NodeCapacityQueueList", () => {
  function render(items: QueueWorkItemViewModel[], kind: "label" | "any" = "label") {
    return renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(NodeCapacityQueueList, {
          items,
          pool: { kind, label: kind === "any" ? "Any node" : "linux" },
          onOpenExternal: () => undefined
        })
      )
    );
  }

  it("omits label badges that only repeat the pool", () => {
    assert.doesNotMatch(render([queueItem("job", ["linux"])]), />linux<\/span>/);
    assert.doesNotMatch(render([queueItem("job", [])], "any"), />Any node<\/span>/);
    assert.match(render([queueItem("job", ["linux && docker"])]), />linux &amp;&amp; docker</);
  });
});

describe("NodeCapacitySummary", () => {
  it("combines executors into one direct-labeled bar and tones only problems", () => {
    const html = renderToStaticMarkup(
      createElement(NodeCapacitySummary, {
        summary: {
          ...createEmptyNodeCapacitySummary(),
          totalNodes: 3,
          onlineNodes: 2,
          busyExecutors: 4,
          idleExecutors: 0,
          offlineExecutors: 2,
          queuedCount: 3,
          stuckCount: 0,
          saturatedPoolCount: 1
        }
      })
    );
    assert.match(html, /2\/3 nodes online/);
    assert.match(html, /aria-label="Executors"/);
    assert.match(html, /text-failure-foreground">3<\/dd>/);
    assert.match(html, /text-foreground">0<\/dd>/);
    assert.match(html, /text-failure-foreground"><span[^>]*>0<\/span> idle/);
    assert.match(html, /text-warning-foreground"><span[^>]*>2<\/span> offline/);
    assert.doesNotMatch(html, /Idle executors/);
  });
});

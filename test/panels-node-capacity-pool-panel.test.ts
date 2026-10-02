import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel
} from "../src/shared/nodeCapacity/NodeCapacityContracts";
import { NodeCapacityPoolPanel } from "../src/panels/nodeCapacity/webview/components/NodeCapacityPoolPanel";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

function drainingNode(): NodeCapacityNodeViewModel {
  return {
    displayName: "agent-2",
    name: "agent-2",
    nodeUrl: "https://jenkins.example/computer/agent-2/",
    statusLabel: "Temporarily offline",
    isOffline: true,
    isTemporarilyOffline: true,
    labels: ["linux"],
    poolLabels: ["linux"],
    hiddenLabels: [],
    totalExecutors: 2,
    busyExecutors: 1,
    idleExecutors: 0,
    offlineExecutors: 2,
    executorSummary: "2 offline",
    executorsLoaded: true,
    executors: [
      {
        id: "#0",
        statusLabel: "Busy",
        isIdle: false,
        workLabel: "api » main #7",
        workUrl: "https://jenkins.example/job/api/job/main/7/"
      },
      { id: "#1", statusLabel: "Idle", isIdle: true }
    ],
    matchingQueueItems: [],
    anyQueueItems: [],
    selfLabelQueueItems: []
  };
}

function renderPool(
  nodes: NodeCapacityNodeViewModel[],
  totals: Partial<NodeCapacityPoolViewModel>,
  isOpen = true
) {
  const pool: NodeCapacityPoolViewModel = {
    id: "linux",
    label: "linux",
    kind: "label",
    severity: "warning",
    statusLabel: "Busy",
    nodes,
    queueItems: [],
    totalNodes: nodes.length,
    onlineNodes: 0,
    offlineNodes: nodes.length,
    totalExecutors: 0,
    busyExecutors: 0,
    idleExecutors: 0,
    offlineExecutors: 0,
    queuedCount: 0,
    stuckCount: 0,
    blockedCount: 0,
    buildableCount: 0,
    ...totals
  };
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(NodeCapacityPoolPanel, {
        pool,
        isOpen,
        onOpenExternal: () => undefined,
        onOpenNodeDetails: () => undefined,
        onRetryExecutors: () => undefined,
        onToggleExpanded: () => undefined
      })
    )
  );
}

describe("NodeCapacityPoolPanel", () => {
  it("keeps listing builds still running on a temporarily offline node", () => {
    const html = renderPool([drainingNode()], {
      totalExecutors: 2,
      busyExecutors: 1,
      offlineExecutors: 2
    });
    assert.match(html, /api » main #7/);
  });

  it("hides the empty work note for offline nodes with nothing running", () => {
    const node = drainingNode();
    const idleNode = {
      ...node,
      busyExecutors: 0,
      executors: node.executors.map((executor) => ({ ...executor, isIdle: true }))
    };
    const html = renderPool([idleNode], { totalExecutors: 2, offlineExecutors: 2 });
    assert.doesNotMatch(html, /No builds running/);
  });

  it("does not double-count busy executors on offline nodes in the capacity bar", () => {
    // Pool totals count a draining node's running build as both busy and offline.
    const html = renderPool([drainingNode()], {
      totalExecutors: 6,
      busyExecutors: 3,
      idleExecutors: 1,
      offlineExecutors: 3
    });
    assert.match(html, /aria-label="Executors: 3 busy, 1 idle, 2 offline"/);
  });

  it("summarizes offline capacity in the header instead of repeating offline nodes", () => {
    const html = renderPool([drainingNode()], {
      totalExecutors: 2,
      busyExecutors: 1,
      offlineExecutors: 2
    });
    assert.match(html, /2 executors unavailable on 1 offline node/);
    assert.doesNotMatch(html, /Offline capacity impact/);
  });

  it("renders an inline count summary for narrow layouts with tones on problem values", () => {
    const html = renderPool([drainingNode()], {
      totalExecutors: 2,
      busyExecutors: 1,
      offlineExecutors: 2,
      queuedCount: 3
    });
    assert.match(html, /lg:hidden/);
    assert.match(html, /text-failure-foreground[^"]*"><span[^>]*>3<\/span> queued/);
    assert.match(html, /text-warning-foreground[^"]*"><span[^>]*>2<\/span> offline/);
  });

  it("makes the node name the Node Details link and keeps one Open in Jenkins action", () => {
    const html = renderPool([drainingNode()], { totalExecutors: 2, offlineExecutors: 2 });
    assert.match(
      html,
      /<button[^>]*title="agent-2 \(open node details\)"[^>]*>agent-2<span class="sr-only">, open node details<\/span><\/button>/
    );
    assert.match(html, /aria-label="Open agent-2 in Jenkins"/);
    assert.doesNotMatch(html, /Open node details for/);
  });

  it("shows inline loading and failure states for running work", () => {
    const online: NodeCapacityNodeViewModel = {
      ...drainingNode(),
      isOffline: false,
      isTemporarilyOffline: false,
      statusLabel: "Online",
      executorsLoaded: false,
      executors: []
    };
    const loading = renderPool([{ ...online, executorsLoadState: "loading" }], {});
    assert.match(loading, /Loading running work…/);

    const failed = renderPool(
      [{ ...online, executorsLoadState: "error", executorsError: "HTTP 500" }],
      {}
    );
    assert.match(failed, /Couldn(&#x27;|')t load running work/);
    assert.match(failed, /aria-label="Retry loading running work on agent-2"/);
  });

  it("names the disclosure button with only the pool label and status", () => {
    const html = renderPool([drainingNode()], { totalExecutors: 2, offlineExecutors: 2 });
    const button = html.match(/<button[^>]*aria-expanded="true"[^>]*>(.*?)<\/button>/);
    assert.ok(button, "expected a disclosure button");
    assert.match(button[0], /aria-controls="capacity-pool-/);
    assert.equal(button[1], 'linux<span class="sr-only">, Busy</span>');
    assert.doesNotMatch(html, /<summary/);
  });

  it("hides pool content when collapsed and points the chevron right", () => {
    const html = renderPool([drainingNode()], { totalExecutors: 2 }, false);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /<div id="capacity-pool-[^"]*" hidden=""/);
    assert.doesNotMatch(html, /agent-2/);
    assert.match(html, /<polyline points="9 6 15 12 9 18"/);
  });

  it("uses warning for temporarily offline nodes and failure for disconnected ones", () => {
    const temporary = renderPool([drainingNode()], { totalExecutors: 2 });
    assert.match(temporary, /border-warning-border bg-warning-soft/);
    assert.doesNotMatch(temporary, /bg-failure-soft/);

    const disconnected = renderPool(
      [{ ...drainingNode(), isTemporarilyOffline: false, statusLabel: "Offline" }],
      { totalExecutors: 2 }
    );
    assert.match(disconnected, /border-failure-border bg-failure-soft/);
    assert.match(disconnected, /text-failure-foreground[^"]*">Offline<\/span>/);
  });

  it("keeps the full offline reason reachable", () => {
    const reason = "Disconnected: the agent process exited after the controller restarted.";
    const html = renderPool([{ ...drainingNode(), offlineReason: reason }], { totalExecutors: 2 });
    assert.match(html, new RegExp(`title="${reason}"`));
  });
});

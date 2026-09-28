import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacitySeverity
} from "../src/shared/nodeCapacity/NodeCapacityContracts";
import {
  isUserInitiatedPoolToggle,
  NodeCapacityPoolPanel
} from "../src/panels/nodeCapacity/webview/components/NodeCapacityPoolPanel";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

/**
 * Mirrors how `isPoolOpen` resolves a pool's open state: an explicit user
 * override wins, otherwise abnormal severity expands the pool.
 */
function resolveOpen(override: boolean | undefined, severity: NodeCapacitySeverity): boolean {
  return override ?? severity !== "normal";
}

describe("isUserInitiatedPoolToggle", () => {
  it("ignores toggle events caused by the controlled open prop changing", () => {
    // React already re-rendered with the new prop by the time `toggle` fires.
    assert.equal(isUserInitiatedPoolToggle(true, true), false);
    assert.equal(isUserInitiatedPoolToggle(false, false), false);
  });

  it("records toggles where the DOM diverges from the controlled prop", () => {
    assert.equal(isUserInitiatedPoolToggle(true, false), true);
    assert.equal(isUserInitiatedPoolToggle(false, true), true);
  });

  it("does not turn automatic severity expansion into a persistent override", () => {
    let override: boolean | undefined;
    const applyToggle = (domOpen: boolean, controlledOpen: boolean) => {
      if (isUserInitiatedPoolToggle(domOpen, controlledOpen)) {
        override = domOpen;
      }
    };

    // Untouched normal pool: closed.
    assert.equal(resolveOpen(override, "normal"), false);

    // Refresh into warning: React sets open=true, then the browser fires
    // `toggle` with the DOM matching the already-updated prop.
    const warningOpen = resolveOpen(override, "warning");
    assert.equal(warningOpen, true);
    applyToggle(true, warningOpen);
    assert.equal(override, undefined);

    // Refresh back to normal: same sequence with open=false.
    const normalOpen = resolveOpen(override, "normal");
    applyToggle(false, normalOpen);
    assert.equal(override, undefined);
    assert.equal(normalOpen, false);
  });

  it("still lets a user collapse an automatically expanded pool", () => {
    let override: boolean | undefined;
    const controlledOpen = resolveOpen(override, "critical");
    assert.equal(controlledOpen, true);

    // User clicks the summary: the browser flips the DOM before React sees it.
    if (isUserInitiatedPoolToggle(false, controlledOpen)) {
      override = false;
    }
    assert.equal(override, false);
    assert.equal(resolveOpen(override, "critical"), false);
  });
});

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
  totals: Partial<NodeCapacityPoolViewModel>
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
        isOpen: true,
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
});

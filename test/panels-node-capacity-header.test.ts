import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { NodeCapacityPoolViewModel } from "../src/shared/nodeCapacity/NodeCapacityContracts";
import { NodeCapacityHeader } from "../src/panels/nodeCapacity/webview/components/NodeCapacityHeader";
import { NodeCapacityPoolList } from "../src/panels/nodeCapacity/webview/components/NodeCapacityPoolList";
import {
  collectAutoOpenedPoolIds,
  isPoolOpen,
  resolvePoolOpenStates
} from "../src/panels/nodeCapacity/webview/hooks/useNodeCapacityExecutorLoading";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

function renderHeader(overrides: Partial<Parameters<typeof NodeCapacityHeader>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(NodeCapacityHeader, {
        environmentLabel: "Production",
        loading: false,
        loadFailed: false,
        isStale: false,
        updatedAtLabel: "Updated 2m ago",
        updatedAtAbsolute: "9/27/2026, 10:00:00 AM",
        onRefresh: () => undefined,
        ...overrides
      })
    )
  );
}

function pool(
  id: string,
  severity: NodeCapacityPoolViewModel["severity"]
): NodeCapacityPoolViewModel {
  return {
    id,
    label: id,
    kind: "label",
    severity,
    statusLabel: "Healthy",
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
    buildableCount: 0
  };
}

function renderPools(pools: NodeCapacityPoolViewModel[]): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(NodeCapacityPoolList, {
        pools,
        poolOpenStates: new Map(),
        onOpenExternal: () => undefined,
        onOpenNodeDetails: () => undefined,
        onRetryExecutors: () => undefined,
        onToggleExpanded: () => undefined
      })
    )
  );
}

describe("NodeCapacityHeader", () => {
  it("shows the environment and the snapshot time with an accessible absolute time", () => {
    const html = renderHeader();

    assert.match(html, /Production/);
    assert.match(html, /Node Capacity/);
    assert.match(html, /Updated 2m ago/);
    assert.match(html, /<span class="sr-only"> \(9\/27\/2026, 10:00:00 AM\)<\/span>/);
    assert.doesNotMatch(html, /Stale/);
    assert.doesNotMatch(html, /animate-spin/);
  });

  it("flags stale snapshots", () => {
    assert.match(renderHeader({ isStale: true }), /Stale/);
  });

  it("hides the stale badge and snapshot time when the load failed", () => {
    const html = renderHeader({ isStale: true, loadFailed: true });

    assert.doesNotMatch(html, /Stale/);
    assert.doesNotMatch(html, /Updated/);
  });

  it("disables and spins the refresh button while loading", () => {
    const html = renderHeader({ loading: true });

    assert.match(html, /animate-spin/);
    assert.match(html, /disabled=""/);
  });
});

describe("NodeCapacityPoolList", () => {
  it("shows the empty state without repeating the header Refresh action", () => {
    const html = renderPools([]);

    assert.match(html, /No node capacity data/);
    assert.match(html, /aria-label="Label pools"/);
    assert.doesNotMatch(html, /<button/);
  });

  it("renders a panel per pool", () => {
    const html = renderPools([pool("linux", "normal"), pool("windows", "critical")]);

    assert.doesNotMatch(html, /No node capacity data/);
    assert.match(html, /linux/);
    assert.match(html, /windows/);
  });
});

describe("pool open state", () => {
  it("treats pools without an open state as closed", () => {
    assert.equal(isPoolOpen(pool("a", "warning"), new Map()), false);
    assert.equal(isPoolOpen(pool("a", "normal"), new Map([["a", true]])), true);
  });

  it("auto-opens abnormal pools once and never auto-closes them while polling", () => {
    let autoOpened = collectAutoOpenedPoolIds(
      [pool("a", "normal"), pool("b", "warning")],
      new Set()
    );
    assert.deepEqual([...autoOpened], ["b"]);

    // Next poll: b recovers, a degrades. b stays open; a opens.
    autoOpened = collectAutoOpenedPoolIds([pool("a", "critical"), pool("b", "normal")], autoOpened);
    assert.deepEqual([...autoOpened].sort(), ["a", "b"]);

    const states = resolvePoolOpenStates(autoOpened, new Map());
    assert.equal(isPoolOpen(pool("b", "normal"), states), true);
  });

  it("keeps the same set when a poll opens nothing new, so renders stay memoized", () => {
    const previous = collectAutoOpenedPoolIds([pool("a", "warning")], new Set());
    assert.equal(
      collectAutoOpenedPoolIds([pool("a", "warning"), pool("c", "normal")], previous),
      previous
    );
  });

  it("lets user toggles override the automatic decision", () => {
    const states = resolvePoolOpenStates(
      new Set(["a"]),
      new Map([
        ["a", false],
        ["c", true]
      ])
    );
    assert.equal(isPoolOpen(pool("a", "critical"), states), false);
    assert.equal(isPoolOpen(pool("c", "normal"), states), true);
  });
});

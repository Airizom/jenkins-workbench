import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, vi } from "vitest";
import { nodeDetailsScenarios } from "../dev/webview-preview/fixtures/nodeDetails";
import { buildNodeActionCapabilities } from "../src/jenkins/nodeActionCapabilities";
import { ExecutorsTableCard } from "../src/panels/nodeDetails/webview/components/nodeDetails/ExecutorsTableCard";
import { NodeDetailsAdvancedSection } from "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsAdvancedSection";
import { NodeDetailsAlerts } from "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsAlerts";
import {
  type NodeAction,
  NodeDetailsHero
} from "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsHero";
import { buildStatusRows } from "../src/panels/nodeDetails/webview/components/nodeDetails/nodeDetailsUtils";
import {
  getInitialState,
  nodeDetailsReducer
} from "../src/panels/nodeDetails/webview/state/nodeDetailsState";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

describe("nodeDetailsReducer advanced request", () => {
  it("marks diagnostics requested until the host answers", () => {
    vi.stubGlobal("window", {});
    const initial = { ...getInitialState(), loading: false, hasLoaded: true };
    vi.unstubAllGlobals();
    const requested = nodeDetailsReducer(initial, { type: "advancedRequested" });
    assert.equal(requested.advancedRequested, true);

    const answered = nodeDetailsReducer(requested, {
      type: "updateNodeDetails",
      payload: { type: "updateNodeDetails", payload: nodeDetailsScenarios.online }
    });
    assert.equal(answered.advancedRequested, false);
  });
});

describe("NodeDetailsAdvancedSection", () => {
  const render = (advancedRequested: boolean, loading = false) =>
    renderToStaticMarkup(
      createElement(NodeDetailsAdvancedSection, {
        advancedLoaded: false,
        advancedRequested,
        loading,
        monitorData: [],
        loadStatistics: [],
        rawJson: "{}",
        onCopyJson: () => undefined,
        onRetry: () => undefined
      })
    );

  it("shows the loading state as soon as diagnostics are requested", () => {
    const html = render(true);
    assert.match(html, /Loading diagnostics…/);
    assert.doesNotMatch(html, /Diagnostics not loaded/);
  });

  it("offers Retry only after a request finished without data", () => {
    assert.match(render(false), /Diagnostics not loaded/);
  });
});

describe("NodeDetailsAlerts", () => {
  const render = (refreshFailed: boolean, loading: boolean) =>
    renderToStaticMarkup(
      createElement(NodeDetailsAlerts, {
        errors: ["HTTP 502"],
        refreshFailed,
        loading,
        onRetry: () => undefined
      })
    );

  it("says the panel shows the last loaded details after a failed refresh", () => {
    assert.match(render(true, false), /Refresh failed\. Showing the last loaded details\./);
    assert.match(render(false, false), /Unable to load full node details/);
  });

  it("disables Retry while loading", () => {
    assert.match(render(true, true), /<button[^>]*disabled=""[^>]*>.*Retry<\/button>/);
    assert.doesNotMatch(render(true, false), /disabled=""/);
  });
});

describe("buildStatusRows", () => {
  const base = {
    statusLabel: "Online",
    executorsLabel: "1 of 2 busy",
    activityLabel: "Running builds",
    isOffline: false,
    offlineSinceMs: undefined
  };

  it("does not repeat the hero status", () => {
    const labels = buildStatusRows(base).map((row) => row.label);
    assert.deepEqual(labels, ["Executors", "Activity"]);
    assert.deepEqual(
      buildStatusRows({ ...base, statusLabel: "Idle", activityLabel: "Idle" }).map(
        (row) => row.label
      ),
      ["Executors"]
    );
  });

  it("shows how long an offline node has been offline instead of Offline again", () => {
    const rows = buildStatusRows({
      ...base,
      statusLabel: "Offline",
      activityLabel: "Offline",
      isOffline: true,
      offlineSinceMs: Date.now() - 2 * 60 * 60_000
    });
    assert.deepEqual(
      rows.map((row) => [row.label, row.value]),
      [
        ["Executors", "1 of 2 busy"],
        ["Offline since", "2h ago"]
      ]
    );
    assert.ok(rows[1]?.title);
  });
});

function renderHero(options: {
  statusClass: "online" | "offline" | "temporary";
  nodeAction?: NodeAction;
  canLaunchAgent?: boolean;
  canOpenAgentInstructions?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(NodeDetailsHero, {
        environmentLabel: "jenkins.example.com",
        displayName: "agent-1",
        name: "agent-1",
        statusLabel: options.statusClass === "temporary" ? "Temporarily offline" : "Offline",
        statusClass: options.statusClass,
        statusAccent: "bg-failure",
        isStale: false,
        updatedAtLabel: "Updated just now",
        updatedAtTitle: "now",
        loading: false,
        nodeAction: options.nodeAction,
        canLaunchAgent: options.canLaunchAgent ?? false,
        canOpenAgentInstructions: options.canOpenAgentInstructions ?? false,
        hasUrl: true,
        showOfflineBanner: options.statusClass !== "online",
        isOffline: options.statusClass !== "online",
        offlineReason: "Reason",
        executors: [],
        oneOffExecutors: [],
        executorsLabel: "2 offline",
        activityLabel: "Offline",
        onRefresh: () => undefined,
        onNodeAction: () => undefined,
        onLaunchAgent: () => undefined,
        onOpen: () => undefined
      })
    )
  );
}

/** Buttons rendered with the filled primary variant. */
function primaryButtons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*class="[^"]*bg-primary [^"]*"[^>]*>(.*?)<\/button>/g)].map(
    (match) => match[1]?.replace(/<[^>]+>/g, "") ?? ""
  );
}

describe("NodeDetailsHero", () => {
  it("shows the environment as an eyebrow", () => {
    assert.match(renderHero({ statusClass: "online" }), />jenkins\.example\.com</);
  });

  it("makes the state-resolving action the only primary button", () => {
    assert.deepEqual(
      primaryButtons(
        renderHero({
          statusClass: "temporary",
          nodeAction: { type: "bringNodeOnline", label: "Bring online" }
        })
      ),
      ["Bring online"]
    );
    assert.deepEqual(primaryButtons(renderHero({ statusClass: "offline", canLaunchAgent: true })), [
      "Launch agent"
    ]);
    assert.deepEqual(
      primaryButtons(renderHero({ statusClass: "offline", canOpenAgentInstructions: true })),
      ["Launch instructions"]
    );
    assert.deepEqual(
      primaryButtons(
        renderHero({
          statusClass: "online",
          nodeAction: { type: "takeNodeOffline", label: "Take offline…" }
        })
      ),
      []
    );
  });

  it("uses the failure tone for disconnected nodes and warning for temporarily offline", () => {
    assert.match(renderHero({ statusClass: "offline" }), /border-failure-border bg-failure-soft/);
    assert.match(renderHero({ statusClass: "temporary" }), /border-warning-border bg-warning-soft/);
  });
});

describe("ExecutorsTableCard", () => {
  const entries = [{ id: "0", statusLabel: "Offline", isIdle: true }];
  const render = (isOffline: boolean) =>
    renderToStaticMarkup(
      createElement(ExecutorsTableCard, {
        title: "Executors",
        entries,
        isOffline,
        onOpenExternal: () => undefined
      })
    );

  it("labels the free-executor filter Offline on offline nodes", () => {
    assert.match(render(true), />Offline</);
    assert.doesNotMatch(render(true), />Idle</);
    assert.match(render(false), />Idle</);
  });

  it("names the compact filter select", () => {
    assert.match(render(false), /<button[^>]*aria-label="Executor filter"/);
  });
});

describe("node details preview fixtures", () => {
  it("only use action flags the host eligibility logic can produce", () => {
    const flagKeys = [
      "isOffline",
      "isTemporarilyOffline",
      "canTakeOffline",
      "canBringOnline",
      "canLaunchAgent",
      "canOpenAgentInstructions"
    ] as const;
    for (const [name, scenario] of Object.entries(nodeDetailsScenarios)) {
      const producible = [
        buildNodeActionCapabilities(),
        ...[true, false].flatMap((offline) =>
          [true, false].flatMap((temporarilyOffline) =>
            [true, false].flatMap((launchSupported) =>
              [true, false].map((manualLaunchAllowed) =>
                buildNodeActionCapabilities({
                  offline,
                  temporarilyOffline,
                  launchSupported,
                  manualLaunchAllowed
                })
              )
            )
          )
        )
      ];
      const flags = Object.fromEntries(flagKeys.map((key) => [key, scenario[key]]));
      assert.ok(
        producible.some((capabilities) =>
          flagKeys.every((key) => capabilities[key] === flags[key])
        ),
        `${name} has impossible action flags`
      );
      assert.equal(typeof scenario.environmentLabel, "string", `${name} environmentLabel`);
    }
  });
});

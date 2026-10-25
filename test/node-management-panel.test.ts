import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { isBuiltInNode } from "../src/jenkins/nodeActionCapabilities";
import { routeNodeDetailsMessage } from "../src/panels/nodeDetails/NodeDetailsMessageRouter";
import { buildNodeDetailsViewModel } from "../src/panels/nodeDetails/NodeDetailsViewModel";
import { emptyNodeAgentLogState } from "../src/panels/nodeDetails/shared/NodeAgentLogContracts";
import { parseNodeDetailsOutgoingMessage } from "../src/panels/nodeDetails/shared/NodeDetailsPanelMessages";
import { isNodeDetailsPanelState } from "../src/panels/nodeDetails/shared/NodeDetailsPanelWebviewState";
import { NodeAgentLogSection } from "../src/panels/nodeDetails/webview/components/nodeDetails/NodeAgentLogSection";
import { NodeDetailsActions } from "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsActions";
import {
  nodeDetailsReducer,
  type NodeDetailsState
} from "../src/panels/nodeDetails/webview/state/nodeDetailsState";

describe("node management panel contract", () => {
  it("routes only validated management, tab, and following messages", () => {
    const received: unknown[] = [];
    const handlers = {
      refresh: async () => {},
      loadAdvanced: async () => {},
      performAction: async () => {},
      openExternal: async () => {},
      copyJson: async () => {},
      manageNode: async (value: string) => {
        received.push(value);
      },
      selectTab: (value: string) => {
        received.push(value);
      },
      setLogFollowing: (value: boolean) => {
        received.push(value);
      },
      refreshLog: () => {
        received.push("refreshLog");
      },
      copyLog: async () => {
        received.push("copyLog");
      }
    };
    for (const type of ["editNodeLabels", "disconnectNodeAgent", "copyNode", "deleteNode"])
      routeNodeDetailsMessage({ type }, handlers);
    routeNodeDetailsMessage({ type: "setNodeDetailsTab", tab: "agentLog" }, handlers);
    routeNodeDetailsMessage({ type: "setNodeAgentLogFollowing", following: false }, handlers);
    routeNodeDetailsMessage({ type: "refreshNodeAgentLog" }, handlers);
    routeNodeDetailsMessage({ type: "copyNodeAgentLog" }, handlers);
    routeNodeDetailsMessage({ type: "setNodeDetailsTab", tab: "unknown" }, handlers);
    routeNodeDetailsMessage({ type: "setNodeAgentLogFollowing", following: "false" }, handlers);
    assert.deepEqual(received, [
      "editNodeLabels",
      "disconnectNodeAgent",
      "copyNode",
      "deleteNode",
      "agentLog",
      false,
      "refreshLog",
      "copyLog"
    ]);
  });

  it("validates log snapshots before the webview consumes them", () => {
    const payload = emptyNodeAgentLogState();
    assert.deepEqual(parseNodeDetailsOutgoingMessage({ type: "updateNodeAgentLog", payload }), {
      type: "updateNodeAgentLog",
      payload
    });
    for (const invalid of [
      { ...payload, text: 1 },
      { ...payload, error: false },
      { ...payload, catchingUp: "true" },
      { ...payload, omitted: "true" }
    ]) {
      assert.equal(
        parseNodeDetailsOutgoingMessage({ type: "updateNodeAgentLog", payload: invalid }),
        undefined
      );
    }
    assert.deepEqual(
      parseNodeDetailsOutgoingMessage({ type: "copyNodeAgentLogResult", success: true }),
      { type: "copyNodeAgentLogResult", success: true }
    );
    assert.equal(
      parseNodeDetailsOutgoingMessage({ type: "copyNodeAgentLogResult", success: "true" }),
      undefined
    );
  });

  it("preserves log output and tab selection when node details refresh", () => {
    const model = buildNodeDetailsViewModel({ errors: [] });
    const agentLog = { ...emptyNodeAgentLogState(), text: "keep this output" };
    const state = {
      ...model,
      loading: false,
      hasLoaded: true,
      advancedRequested: false,
      activeTab: "agentLog",
      agentLog
    } as NodeDetailsState;
    const refreshed = nodeDetailsReducer(state, {
      type: "updateNodeDetails",
      payload: { type: "updateNodeDetails", payload: model }
    });
    assert.equal(refreshed.agentLog, agentLog);
    assert.equal(refreshed.activeTab, "agentLog");
    const paused = nodeDetailsReducer(refreshed, {
      type: "updateNodeAgentLog",
      payload: { ...agentLog, following: false }
    });
    assert.equal(paused.agentLog.following, false);
    assert.equal(
      nodeDetailsReducer(paused, { type: "selectTab", tab: "overview" }).activeTab,
      "overview"
    );
  });

  it("accepts lightweight log preferences but rejects invalid tab or follow values", () => {
    const state = {
      scope: "workspace",
      environmentId: "env",
      nodeUrl: "http://jenkins/computer/a/",
      activeTab: "agentLog",
      logFollowing: false
    };
    assert.equal(isNodeDetailsPanelState(state), true);
    assert.equal(isNodeDetailsPanelState({ ...state, activeTab: "bad" }), false);
    assert.equal(isNodeDetailsPanelState({ ...state, logFollowing: "false" }), false);
  });
});

describe("node management UI", () => {
  it("shows management actions while keeping built-in actions absent", () => {
    const html = renderToStaticMarkup(
      React.createElement(NodeDetailsActions, {
        disabled: false,
        canManageNode: true,
        canDisconnectAgent: true,
        onAction: () => {}
      })
    );
    for (const label of ["Edit labels", "Disconnect agent", "Copy node", "Delete node"])
      assert.match(html, new RegExp(label));
    assert.equal(
      renderToStaticMarkup(
        React.createElement(NodeDetailsActions, {
          disabled: false,
          canManageNode: false,
          canDisconnectAgent: false,
          onAction: () => {}
        })
      ),
      ""
    );
  });

  it("dispatches valid management selections and ignores placeholder or unknown values", () => {
    const actions: string[] = [];
    const element = NodeDetailsActions({
      disabled: false,
      canManageNode: true,
      canDisconnectAgent: true,
      onAction: (action) => actions.push(action)
    });
    assert.ok(element);
    const onChange = (element.props as { onChange: (event: { target: { value: string } }) => void })
      .onChange;
    for (const value of [
      "",
      "unexpected",
      "editNodeLabels",
      "disconnectNodeAgent",
      "copyNode",
      "deleteNode"
    ]) {
      onChange({ target: { value } });
    }
    assert.deepEqual(actions, ["editNodeLabels", "disconnectNodeAgent", "copyNode", "deleteNode"]);
  });

  it("renders plain text, log controls, truncation, and retry without executing markup", () => {
    const html = renderToStaticMarkup(
      React.createElement(NodeAgentLogSection, {
        state: {
          text: "<script>alert(1)</script>",
          loading: false,
          following: false,
          omitted: true,
          error: "denied"
        }
      })
    );
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    for (const label of ["Follow", "Refresh log", "Copy log", "Older log output omitted", "Retry"])
      assert.ok(html.includes(label));
  });

  it("makes pagination catch-up visible instead of claiming the output is current", () => {
    const html = renderToStaticMarkup(
      React.createElement(NodeAgentLogSection, {
        state: { ...emptyNodeAgentLogState(), catchingUp: true }
      })
    );
    assert.match(html, /Catching up with agent output/);
    assert.doesNotMatch(html, /Following recent output/);
  });

  it("recognizes built-in nodes and still permits disconnecting temporarily offline agents", () => {
    for (const node of [
      { name: "" },
      { _class: "hudson.model.Hudson$MasterComputer" },
      { nodeUrl: "http://jenkins/computer/%28built-in%29/" },
      { nodeUrl: "http://jenkins/computer/(master)/" }
    ])
      assert.equal(isBuiltInNode(node), true);
    assert.equal(isBuiltInNode({ name: "agent" }), false);
    assert.equal(isBuiltInNode({ nodeUrl: "bad url" }), false);
    const model = buildNodeDetailsViewModel({
      details: { displayName: "agent", name: "agent", offline: true, temporarilyOffline: true },
      errors: []
    });
    assert.equal(model.canManageNode, true);
    assert.equal(model.canDisconnectAgent, true);
  });
});

describe("node panel action target lifetime", () => {
  it("closes only the exact deleted target and leaves a replacement target open", async () => {
    const { NodeDetailsPanel } = await import("../src/panels/NodeDetailsPanel");
    const environment = {
      environmentId: "env",
      scope: "workspace" as const,
      url: "http://jenkins/"
    };
    let disposed = false;
    const current = Object.assign(Object.create(NodeDetailsPanel.prototype), {
      environment,
      nodeUrl: "http://jenkins/computer/replacement/",
      panel: {
        dispose: () => {
          disposed = true;
        }
      }
    });
    const previous = NodeDetailsPanel["currentPanel"];
    NodeDetailsPanel["currentPanel"] = current;
    try {
      NodeDetailsPanel.closeForNode(environment, "http://jenkins/computer/deleted/");
      assert.equal(disposed, false);
      NodeDetailsPanel.closeForNode({ ...environment, scope: "global" }, current.nodeUrl);
      assert.equal(disposed, false);
      current.nodeUrl = "http://jenkins/computer/a+b/";
      NodeDetailsPanel.closeForNode(environment, "http://jenkins/computer/a%2Bb/");
      assert.equal(disposed, true);
    } finally {
      NodeDetailsPanel["currentPanel"] = previous;
    }
  });

  it("never refreshes a replacement target after an old action completes", async () => {
    const { NodeDetailsPanel } = await import("../src/panels/NodeDetailsPanel");
    const environment = {
      environmentId: "env",
      scope: "workspace" as const,
      url: "http://jenkins/"
    };
    let complete!: (value: boolean) => void;
    let refreshes = 0;
    const current = Object.assign(Object.create(NodeDetailsPanel.prototype), {
      environment,
      nodeUrl: "http://jenkins/computer/original/",
      hasRendered: true,
      disposed: false,
      nodeActionService: {
        editNodeLabels: () =>
          new Promise<boolean>((resolve) => {
            complete = resolve;
          })
      },
      refreshDetailsWith: async () => {
        refreshes += 1;
      }
    }) as import("../src/panels/NodeDetailsPanel").NodeDetailsPanel;
    const action = current["handleManagementAction"]("editNodeLabels");
    current["nodeUrl"] = "http://jenkins/computer/replacement/";
    complete(true);
    await action;
    assert.equal(refreshes, 0);
    assert.equal(current["managementPending"], false);
  });
});

import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";

const informationMessages: string[] = [];
const actionCalls: Array<{ action: string; target: { nodeUrl: string; label: string } }> = [];
const detailsPanelCalls: Array<{ initialTab?: string }> = [];
const closedPanels: unknown[] = [];
let actionResult = true;

const vscodeMock = {
  window: {
    showInformationMessage: async (message: string) => {
      informationMessages.push(message);
      return undefined;
    }
  }
};

class TestNodeTreeItem {
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly nodeUrl: string | undefined,
    public readonly label: string
  ) {}
}

class TestNodesFolderTreeItem {
  constructor(public readonly environment: JenkinsEnvironmentRef) {}
}

class TestNodeActionService {
  async editNodeLabels(target: { nodeUrl: string; label: string }): Promise<boolean> {
    actionCalls.push({ action: "editNodeLabels", target });
    return actionResult;
  }
  async disconnectNodeAgent(target: { nodeUrl: string; label: string }): Promise<boolean> {
    actionCalls.push({ action: "disconnectNodeAgent", target });
    return actionResult;
  }
  async copyNode(target: { nodeUrl: string; label: string }): Promise<boolean> {
    actionCalls.push({ action: "copyNode", target });
    return actionResult;
  }
  async deleteNode(target: { nodeUrl: string; label: string }): Promise<boolean> {
    actionCalls.push({ action: "deleteNode", target });
    return actionResult;
  }
  async createNode(environment: JenkinsEnvironmentRef) {
    return { environment, nodeUrl: "computer/new-agent/", label: "new-agent" };
  }
  async takeNodeOffline(target: { nodeUrl: string; label: string }): Promise<boolean> {
    actionCalls.push({ action: "takeNodeOffline", target });
    return true;
  }

  async bringNodeOnline(target: { nodeUrl: string; label: string }): Promise<boolean> {
    actionCalls.push({ action: "bringNodeOnline", target });
    return true;
  }

  async launchNodeAgent(target: { nodeUrl: string; label: string }): Promise<boolean> {
    actionCalls.push({ action: "launchNodeAgent", target });
    return true;
  }
}

vi.doMock("vscode", () => vscodeMock);
vi.doMock("../src/tree/TreeItems", () => ({
  BuildTreeItem: class {},
  NodeTreeItem: TestNodeTreeItem,
  NodesFolderTreeItem: TestNodesFolderTreeItem,
  PipelineTreeItem: class {}
}));
vi.doMock("../src/panels/NodeDetailsPanel", () => ({
  NodeDetailsPanel: {
    closeForNode: (...args: unknown[]) => {
      closedPanels.push(args);
    },
    show: async (options: { initialTab?: string }) => {
      detailsPanelCalls.push(options);
    }
  }
}));
vi.doMock("../src/services/NodeActionService", () => ({
  NodeActionService: TestNodeActionService
}));
const handlers = await import("../src/commands/node/NodeCommandHandlers");

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

const refreshHost = {
  fullEnvironmentRefresh: () => ({ executed: true })
};

beforeEach(() => {
  informationMessages.length = 0;
  actionCalls.length = 0;
  detailsPanelCalls.length = 0;
  closedPanels.length = 0;
  actionResult = true;
});

describe("showNodeDetails", () => {
  it("rejects non-node command targets without opening the panel", async () => {
    const forgedTarget = {
      environment,
      nodeUrl: "computer/agent-1/",
      label: "agent-1"
    };

    await handlers.showNodeDetails(
      {} as never,
      refreshHost as never,
      {} as never,
      forgedTarget as never
    );

    assert.deepEqual(detailsPanelCalls, []);
    assert.deepEqual(informationMessages, ["Select a node to view details."]);
  });

  it("opens the panel for node tree items", async () => {
    const item = new TestNodeTreeItem(environment, "computer/agent-1/", "agent-1") as never;

    await handlers.showNodeDetails({} as never, refreshHost as never, {} as never, item);

    assert.equal(detailsPanelCalls.length, 1);
    assert.deepEqual(informationMessages, []);
  });
});

describe("node mutating command handlers", () => {
  it("rejects forged plain command targets for node actions", async () => {
    const forgedTarget = {
      environment,
      nodeUrl: "computer/agent-1/",
      label: "agent-1"
    };

    assert.equal(
      await handlers.takeNodeOffline({} as never, refreshHost, forgedTarget as never),
      false
    );
    assert.equal(
      await handlers.bringNodeOnline({} as never, refreshHost, forgedTarget as never),
      false
    );
    assert.equal(
      await handlers.launchNodeAgent({} as never, refreshHost, forgedTarget as never),
      false
    );

    assert.deepEqual(actionCalls, []);
    assert.deepEqual(informationMessages, [
      "Select a node to take offline.",
      "Select a node to bring online.",
      "Select a node to launch agent."
    ]);
  });

  it("allows node tree items for node actions", async () => {
    const item = new TestNodeTreeItem(environment, "computer/agent-1/", "agent-1") as never;

    assert.equal(await handlers.bringNodeOnline({} as never, refreshHost, item), true);

    assert.deepEqual(actionCalls, [
      {
        action: "bringNodeOnline",
        target: {
          environment,
          nodeUrl: "computer/agent-1/",
          label: "agent-1"
        }
      }
    ]);
    assert.deepEqual(informationMessages, []);
  });
});

describe("node management commands", () => {
  it("opens agent logs on the requested tab", async () => {
    const item = new TestNodeTreeItem(environment, "computer/agent-1/", "agent-1") as never;
    await handlers.showNodeAgentLog({} as never, refreshHost, {} as never, item);
    assert.equal(detailsPanelCalls[0].initialTab, "agentLog");
  });

  it.each(["editNodeLabels", "disconnectNodeAgent", "copyNode", "deleteNode"] as const)(
    "validates the target for %s",
    async (action) => {
      assert.equal(
        await handlers[action]({} as never, refreshHost, {
          environment,
          nodeUrl: "computer/forged/"
        } as never),
        false
      );
      assert.equal(actionCalls.length, 0);
      assert.equal(
        await handlers[action](
          {} as never,
          refreshHost,
          new TestNodeTreeItem(environment, undefined, "missing-url") as never
        ),
        false
      );
      assert.equal(actionCalls.length, 0);
    }
  );

  it("closes only the deleted target after success", async () => {
    const item = new TestNodeTreeItem(environment, "computer/agent-1/", "agent-1") as never;
    actionResult = false;
    assert.equal(await handlers.deleteNode({} as never, refreshHost, item), false);
    assert.deepEqual(closedPanels, []);
    actionResult = true;
    assert.equal(await handlers.deleteNode({} as never, refreshHost, item), true);
    assert.deepEqual(closedPanels, [[environment, "computer/agent-1/"]]);
  });

  it("creates in the selected Nodes group and opens details", async () => {
    const store = { listEnvironmentsWithScope: vi.fn() };
    await handlers.createNode(
      {} as never,
      store as never,
      refreshHost,
      {} as never,
      new TestNodesFolderTreeItem(environment) as never
    );
    assert.equal(store.listEnvironmentsWithScope.mock.calls.length, 0);
    assert.equal(detailsPanelCalls.length, 1);
  });

  it("reports when creation has no configured environment", async () => {
    await handlers.createNode(
      {} as never,
      { listEnvironmentsWithScope: async () => [] } as never,
      refreshHost,
      {} as never
    );
    assert.deepEqual(detailsPanelCalls, []);
    assert.match(informationMessages[0], /Add a Jenkins environment/);
  });
});

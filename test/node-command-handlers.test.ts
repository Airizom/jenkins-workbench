import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";

const informationMessages: string[] = [];
const actionCalls: Array<{ action: string; target: { nodeUrl: string; label: string } }> = [];

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

class TestNodeActionService {
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
  PipelineTreeItem: class {}
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

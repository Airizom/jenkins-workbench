import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { NodeActionTarget } from "../src/services/NodeActionService";
import * as vscodeStub from "./helpers/vscodeStub";

const inputs: Array<string | undefined> = [];
const showInputBox = vi.fn(async (_options: Record<string, unknown>) => inputs.shift());
const showInformationMessage = vi.fn(
  async (_message: string, ..._choices: unknown[]) => undefined as string | undefined
);
const showErrorMessage = vi.fn(async (_message: string) => undefined);
const showWarningMessage = vi.fn(
  async (_message: string, ..._choices: unknown[]) => undefined as string | undefined
);
const showQuickPick = vi.fn(async (items: Array<{ mode: string }>) => items[0]);
const openJenkinsWorkbenchUrl = vi.fn(async (_url: string, _source: string) => ({
  ok: true,
  opened: true
}));

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showInputBox,
    showInformationMessage,
    showErrorMessage,
    showWarningMessage,
    showQuickPick
  }
}));
vi.doMock("../src/ui/OpenExternalUrl", () => ({ openJenkinsWorkbenchUrl }));

const { NodeManagementWorkflow } = await import("../src/services/NodeManagementWorkflow");
const { UnsupportedNodeConfigurationError } = await import("../src/jenkins/NodeManagement");

const target: NodeActionTarget = {
  environment: { environmentId: "env", scope: "workspace", url: "https://jenkins.example/" },
  nodeUrl: "https://jenkins.example/computer/agent/",
  label: "Agent display name"
};

function fixture() {
  const data = {
    getNodeConfiguration: vi.fn(async () => ({ name: "agent", labels: 'linux "long label"' })),
    updateNodeLabels: vi.fn(async () => ({ status: "updated", labels: "windows" })),
    getNodeDetails: vi.fn(async () => ({ offline: false, temporarilyOffline: false })),
    disconnectNodeAgent: vi.fn(async () => ({ status: "requested", details: { offline: false } })),
    checkNodeDeletion: vi.fn(async () => ({ idle: true })),
    deleteNode: vi.fn(async () => undefined),
    getNodes: vi.fn(async () => [{ name: "agent", displayName: "Agent display name" }]),
    createNode: vi.fn(async () => ({
      nodeUrl: "https://jenkins.example/computer/new/",
      status: "created"
    })),
    copyNode: vi.fn(async () => ({
      nodeUrl: "https://jenkins.example/computer/agent-copy/",
      status: "copied"
    }))
  };
  const refreshHost = { fullEnvironmentRefresh: vi.fn(() => ({ executed: true })) };
  return {
    data,
    refreshHost,
    workflow: new NodeManagementWorkflow(data as unknown as JenkinsDataService)
  };
}

beforeEach(() => {
  inputs.length = 0;
  vi.clearAllMocks();
  showWarningMessage.mockImplementation(async (_message, ...choices) => choices.at(-1) as string);
  showInformationMessage.mockImplementation(async () => undefined);
  showQuickPick.mockImplementation(async (items) => items[0]);
});

describe("Node label workflow", () => {
  it("rejects control characters while allowing whitespace and quoted labels", async () => {
    const { workflow } = fixture();
    inputs.push(undefined);
    await workflow.editNodeLabels(target);
    const validate = showInputBox.mock.calls[0][0].validateInput as (
      value: string
    ) => string | undefined;
    assert.equal(validate('linux "long label"\t\n\r'), undefined);
    assert.equal(validate(""), undefined);
    for (const character of ["\u0000", "\u0008", "\u001f"]) {
      assert.equal(validate(`linux${character}`), "Labels cannot contain control characters.");
    }
  });

  it("prefills configured labels, preserves quoting, and refreshes after updating", async () => {
    const { data, refreshHost, workflow } = fixture();
    inputs.push('Windows "long label"');
    assert.equal(await workflow.editNodeLabels(target, refreshHost), true);
    assert.equal(showInputBox.mock.calls[0][0].value, 'linux "long label"');
    assert.deepEqual(data.updateNodeLabels.mock.calls[0], [
      target.environment,
      target.nodeUrl,
      'Windows "long label"',
      'linux "long label"'
    ]);
    assert.equal(refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
  });

  it.each([undefined, 'linux "long label"'])(
    "does not write after cancel or unchanged input: %s",
    async (input) => {
      const { data, workflow } = fixture();
      inputs.push(input);
      assert.equal(await workflow.editNodeLabels(target), false);
      assert.equal(data.updateNodeLabels.mock.calls.length, 0);
    }
  );

  it("allows clearing configured labels", async () => {
    const { data, workflow } = fixture();
    inputs.push("");
    await workflow.editNodeLabels(target);
    assert.equal((data.updateNodeLabels.mock.calls[0] as unknown[])[2], "");
  });

  it("reloads after a remote-label conflict instead of overwriting", async () => {
    const { data, workflow } = fixture();
    data.updateNodeLabels.mockResolvedValueOnce({ status: "conflict", labels: "remote" });
    data.getNodeConfiguration
      .mockResolvedValueOnce({ name: "agent", labels: "linux" })
      .mockResolvedValueOnce({ name: "agent", labels: "remote" });
    inputs.push("local", "revised");
    assert.equal(await workflow.editNodeLabels(target), true);
    assert.equal((data.updateNodeLabels.mock.calls[1] as unknown[])[3], "remote");
    assert.equal(showInputBox.mock.calls[1][0].value, "remote");
  });

  it("lets users cancel after conflict and does not refresh", async () => {
    const { data, refreshHost, workflow } = fixture();
    data.updateNodeLabels.mockResolvedValueOnce({ status: "conflict", labels: "remote" });
    showWarningMessage.mockResolvedValueOnce(undefined);
    inputs.push("local");
    assert.equal(await workflow.editNodeLabels(target, refreshHost), false);
    assert.equal(refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
  });

  it("offers Jenkins for unsupported configurations and reports permission failures", async () => {
    const { data, workflow } = fixture();
    data.getNodeConfiguration.mockRejectedValueOnce(new UnsupportedNodeConfigurationError());
    showInformationMessage.mockResolvedValueOnce("Open in Jenkins");
    assert.equal(await workflow.editNodeLabels(target), false);
    assert.equal(openJenkinsWorkbenchUrl.mock.calls[0][0], `${target.nodeUrl}configure`);
    data.getNodeConfiguration.mockRejectedValueOnce(new Error("Permission denied"));
    assert.equal(await workflow.editNodeLabels(target), false);
    assert.match(showErrorMessage.mock.calls[0][0], /Permission denied/);
  });
});

describe("Disconnect and deletion workflows", () => {
  it("states the running-build consequence, trims the reason, and reports a request", async () => {
    const { data, refreshHost, workflow } = fixture();
    inputs.push(" maintenance ");
    assert.equal(await workflow.disconnectNodeAgent(target, refreshHost), true);
    assert.match(String(showInputBox.mock.calls[0][0].prompt), /running builds.*fail/);
    assert.deepEqual(data.disconnectNodeAgent.mock.calls[0], [
      target.environment,
      target.nodeUrl,
      "maintenance"
    ]);
    assert.match(showInformationMessage.mock.calls[0][0], /Disconnect requested/);
  });

  it("does not disconnect after cancellation or an already-offline response", async () => {
    const { data, workflow } = fixture();
    inputs.push(undefined);
    assert.equal(await workflow.disconnectNodeAgent(target), false);
    data.getNodeDetails.mockResolvedValueOnce({ offline: true, temporarilyOffline: false });
    assert.equal(await workflow.disconnectNodeAgent(target), false);
    assert.equal(data.disconnectNodeAgent.mock.calls.length, 0);
  });

  it("allows disconnecting an agent marked temporarily offline", async () => {
    const { data, workflow } = fixture();
    data.getNodeDetails.mockResolvedValueOnce({ offline: true, temporarilyOffline: true });
    inputs.push("");
    assert.equal(await workflow.disconnectNodeAgent(target), true);
    assert.equal(data.disconnectNodeAgent.mock.calls.length, 1);
  });

  it("requires the real node name and final confirmation before deletion", async () => {
    const { data, refreshHost, workflow } = fixture();
    inputs.push("agent");
    assert.equal(await workflow.deleteNode(target, refreshHost), true);
    assert.match(String(showInputBox.mock.calls[0][0].prompt), /"agent"/);
    assert.equal(data.checkNodeDeletion.mock.calls.length, 1);
    assert.equal(data.deleteNode.mock.calls.length, 1);
    assert.equal(refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
  });

  it("does not prompt to delete a busy or unknown node", async () => {
    const { data, workflow } = fixture();
    data.checkNodeDeletion.mockRejectedValueOnce(new Error("Cannot verify this node is idle"));
    assert.equal(await workflow.deleteNode(target), false);
    assert.equal(showInputBox.mock.calls.length, 0);
    assert.equal(data.deleteNode.mock.calls.length, 0);
  });

  it.each(["wrong-name", undefined])(
    "does not delete with a mismatched or cancelled name: %s",
    async (name) => {
      const { data, workflow } = fixture();
      inputs.push(name);
      assert.equal(await workflow.deleteNode(target), false);
      assert.equal(data.deleteNode.mock.calls.length, 0);
    }
  );

  it("does not delete when final confirmation is cancelled or fresh checks fail", async () => {
    const { data, workflow } = fixture();
    inputs.push("agent", "agent");
    showWarningMessage.mockResolvedValueOnce(undefined);
    assert.equal(await workflow.deleteNode(target), false);
    assert.equal(data.deleteNode.mock.calls.length, 0);
    data.deleteNode.mockRejectedValueOnce(new Error("Node became busy"));
    assert.equal(await workflow.deleteNode(target), false);
    assert.match(showErrorMessage.mock.calls[0][0], /Node became busy/);
  });
});

describe("Creation and copy workflows", () => {
  it("collects core settings, reviews them, and returns a target for Node Details", async () => {
    const { data, refreshHost, workflow } = fixture();
    inputs.push("new", "/srv/agent", "2", 'Linux "long label"', "Build host");
    const result = await workflow.createNode(target.environment, refreshHost);
    assert.deepEqual(data.createNode.mock.calls[0], [
      target.environment,
      {
        name: "new",
        remoteFS: "/srv/agent",
        numExecutors: 2,
        labels: 'Linux "long label"',
        mode: "NORMAL",
        description: "Build host"
      }
    ]);
    assert.equal(result?.label, "new");
    assert.match(showWarningMessage.mock.calls[0][0], /Remote root: \/srv\/agent/);
    assert.match(showWarningMessage.mock.calls[0][0], /Executors: 2/);
    assert.equal(refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
  });

  it("rejects duplicate names and invalid executor counts without writing", async () => {
    const { data, workflow } = fixture();
    inputs.push("agent");
    assert.equal(await workflow.createNode(target.environment), undefined);
    inputs.push("new", "/srv/agent", "0");
    assert.equal(await workflow.createNode(target.environment), undefined);
    assert.equal(data.createNode.mock.calls.length, 0);
  });

  it("cancels creation at summary without mutation", async () => {
    const { data, workflow } = fixture();
    inputs.push("new", "/srv/agent", "1", "", "");
    showWarningMessage.mockResolvedValueOnce(undefined);
    assert.equal(await workflow.createNode(target.environment), undefined);
    assert.equal(data.createNode.mock.calls.length, 0);
  });

  it("opens copied configuration and picks a collision-free default name", async () => {
    const { data, workflow } = fixture();
    data.getNodes.mockResolvedValueOnce([
      { name: "agent", displayName: "agent" },
      { name: "agent-copy", displayName: "agent-copy" }
    ]);
    inputs.push("agent-copy-2");
    assert.equal(await workflow.copyNode(target), true);
    assert.equal(showInputBox.mock.calls[0][0].value, "agent-copy-2");
    assert.deepEqual(data.copyNode.mock.calls[0], [
      target.environment,
      target.nodeUrl,
      "agent-copy-2"
    ]);
    assert.equal(
      openJenkinsWorkbenchUrl.mock.calls[0][0],
      "https://jenkins.example/computer/agent-copy/configure"
    );
  });

  it("reports an uncertain creation outcome without silently retrying", async () => {
    const { data, workflow } = fixture();
    data.createNode.mockResolvedValueOnce({
      nodeUrl: "https://jenkins.example/computer/new/",
      status: "exists_after_error"
    });
    inputs.push("new", "/srv/agent", "1", "", "");
    assert.ok(await workflow.createNode(target.environment));
    assert.equal(data.createNode.mock.calls.length, 1);
    assert.match(showWarningMessage.mock.calls[1][0], /did not confirm.*now exists/);
  });
});

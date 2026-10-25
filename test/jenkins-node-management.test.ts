import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import {
  isNodeDefinitelyIdle,
  JenkinsNodeDataOperations
} from "../src/jenkins/data/JenkinsNodeDataOperations";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { UnsupportedNodeConfigurationError } from "../src/jenkins/NodeManagement";
import type { JenkinsNodeDetails } from "../src/jenkins/types";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env",
  scope: "workspace",
  url: "https://example.com/jenkins/"
};
const nodeUrl = `${environment.url}computer/agent/`;
const xml =
  '<slave><name>agent</name><label>linux</label><description>new description</description><launcher class="ssh"><secret>keep</secret></launcher></slave>';
function createOperations(client: Partial<JenkinsClient>) {
  const provider = {
    getClient: async () => client as JenkinsClient,
    getAuthSignature: async () => "auth"
  } as unknown as JenkinsClientProvider;
  return new JenkinsNodeDataOperations(
    new JenkinsDataRuntimeContext(provider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    })
  );
}
function idleDetails(): JenkinsNodeDetails {
  return {
    displayName: "agent",
    offline: false,
    temporarilyOffline: false,
    idle: true,
    busyExecutors: 0,
    numExecutors: 1,
    executors: [{ idle: true }],
    oneOffExecutors: []
  };
}

describe("node management operations", () => {
  it("updates labels against fresh XML while preserving unrelated changes", async () => {
    const updateNodeConfigXml = vi.fn(async () => {});
    const operations = createOperations({
      getNodeConfigXml: vi.fn(async () => xml),
      updateNodeConfigXml
    });
    assert.deepEqual(
      await operations.updateNodeLabels(environment, nodeUrl, 'Linux "gpu"', "linux"),
      { status: "updated", labels: 'Linux "gpu"' }
    );
    const submitted = updateNodeConfigXml.mock.calls as unknown as [string, string][];
    assert.match(submitted[0][1], /<secret>keep<\/secret>/);
    assert.match(submitted[0][1], /<description>new description<\/description>/);
  });

  it("returns conflict or no change without writes", async () => {
    const updateNodeConfigXml = vi.fn(async () => {});
    const operations = createOperations({
      getNodeConfigXml: vi.fn(async () => xml),
      updateNodeConfigXml
    });
    assert.equal(
      (await operations.updateNodeLabels(environment, nodeUrl, "windows", "old")).status,
      "conflict"
    );
    assert.equal(
      (await operations.updateNodeLabels(environment, nodeUrl, "linux", "linux")).status,
      "no_change"
    );
    assert.equal(updateNodeConfigXml.mock.calls.length, 0);
  });

  it("does not cache secret configuration and rejects wrong target identity", async () => {
    const getNodeConfigXml = vi.fn(async () => xml);
    const operations = createOperations({ getNodeConfigXml });
    await operations.getNodeConfiguration(environment, nodeUrl);
    await operations.getNodeConfiguration(environment, nodeUrl);
    assert.equal(getNodeConfigXml.mock.calls.length, 2);
    await assert.rejects(
      operations.getNodeConfiguration(environment, `${environment.url}computer/another/`),
      UnsupportedNodeConfigurationError
    );
  });

  it("serializes conflicting label updates and releases after a failure", async () => {
    let current = xml;
    const updateNodeConfigXml = vi.fn(async (_url: string, value: string) => {
      current = value;
    });
    const operations = createOperations({
      getNodeConfigXml: vi.fn(async () => current),
      updateNodeConfigXml
    });
    const results = await Promise.all([
      operations.updateNodeLabels(environment, nodeUrl, "windows", "linux"),
      operations.updateNodeLabels(environment, nodeUrl, "mac", "linux")
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["updated", "conflict"]
    );
    updateNodeConfigXml.mockRejectedValueOnce(new Error("failed"));
    await assert.rejects(
      operations.updateNodeLabels(environment, nodeUrl, "broken", "windows"),
      /failed/
    );
    assert.equal(
      (await operations.updateNodeLabels(environment, nodeUrl, "mac", "windows")).status,
      "updated"
    );
  });

  it("blocks deletion when fresh work starts after the preflight", async () => {
    const getNodeDetails = vi
      .fn(async () => idleDetails())
      .mockResolvedValueOnce(idleDetails())
      .mockResolvedValueOnce({ ...idleDetails(), busyExecutors: 1, idle: false });
    const deleteNode = vi.fn(async () => {});
    const operations = createOperations({
      getNodeConfigXml: vi.fn(async () => xml),
      getNodeDetails,
      deleteNode
    });
    await operations.checkNodeDeletion(environment, nodeUrl);
    await assert.rejects(operations.deleteNode(environment, nodeUrl), /busy/);
    assert.equal(deleteNode.mock.calls.length, 0);
  });

  it("shares mutation locks across equivalent encoded node URLs", async () => {
    let current = xml.replace("<name>agent</name>", "<name>a+b</name>");
    const updateNodeConfigXml = vi.fn(async (_url: string, value: string) => {
      current = value;
    });
    const operations = createOperations({
      getNodeConfigXml: async () => current,
      updateNodeConfigXml
    });
    const results = await Promise.all([
      operations.updateNodeLabels(
        environment,
        `${environment.url}computer/a+b/`,
        "windows",
        "linux"
      ),
      operations.updateNodeLabels(environment, `${environment.url}computer/a%2Bb/`, "mac", "linux")
    ]);
    assert.deepEqual(
      results.map((result) => result.status),
      ["updated", "conflict"]
    );
    assert.equal(updateNodeConfigXml.mock.calls.length, 1);
  });

  it("deletes a verified idle permanent node", async () => {
    const deleteNode = vi.fn(async () => {});
    const operations = createOperations({
      getNodeConfigXml: vi.fn(async () => xml),
      getNodeDetails: vi.fn(async () => idleDetails()),
      deleteNode
    });
    await operations.deleteNode(environment, nodeUrl);
    assert.equal(deleteNode.mock.calls.length, 1);
  });

  it("requests disconnect without asserting completion and skips disconnected nodes", async () => {
    const disconnectNodeAgent = vi.fn(async () => {});
    const getNodeDetails = vi
      .fn(async () => idleDetails())
      .mockResolvedValueOnce(idleDetails())
      .mockResolvedValueOnce({ ...idleDetails(), offline: true });
    const operations = createOperations({ getNodeDetails, disconnectNodeAgent });
    assert.equal(
      (await operations.disconnectNodeAgent(environment, nodeUrl, "maintenance")).status,
      "requested"
    );
    assert.equal((await operations.disconnectNodeAgent(environment, nodeUrl)).status, "no_change");
    assert.equal(disconnectNodeAgent.mock.calls.length, 1);
  });

  it("disconnects connected temporarily-offline agents", async () => {
    const disconnectNodeAgent = vi.fn(async () => {});
    const operations = createOperations({
      getNodeDetails: vi.fn(async () => ({
        ...idleDetails(),
        offline: true,
        temporarilyOffline: true
      })),
      disconnectNodeAgent
    });
    assert.equal((await operations.disconnectNodeAgent(environment, nodeUrl)).status, "requested");
    assert.equal(disconnectNodeAgent.mock.calls.length, 1);
  });

  it("holds the copy source lock until native copying finishes", async () => {
    let releaseCopy!: () => void;
    let started!: () => void;
    const copyStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waitForCopy = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const updateNodeConfigXml = vi.fn(async () => {});
    const operations = createOperations({
      getNodeConfigXml: vi.fn(async () => xml),
      getNodes: vi.fn(async () => []),
      copyNode: vi.fn(async () => {
        started();
        await waitForCopy;
      }),
      updateNodeConfigXml
    });
    const copying = operations.copyNode(environment, nodeUrl, "copy");
    await copyStarted;
    const editing = operations.updateNodeLabels(environment, nodeUrl, "new-label", "linux");
    await Promise.resolve();
    assert.equal(updateNodeConfigXml.mock.calls.length, 0);
    releaseCopy();
    await copying;
    assert.equal((await editing).status, "updated");
  });

  it("reconciles a lost creation response without retrying", async () => {
    const getNodes = vi
      .fn(async () => [] as Awaited<ReturnType<JenkinsClient["getNodes"]>>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { displayName: "new", name: "new", offline: true, temporarilyOffline: false }
      ]);
    const createNode = vi.fn(async () => {
      throw new Error("connection lost");
    });
    const operations = createOperations({ getNodes, createNode });
    const result = await operations.createNode(environment, {
      name: "new",
      remoteFS: "/tmp/new",
      numExecutors: 1,
      labels: "",
      mode: "NORMAL"
    });
    assert.equal(result.status, "exists_after_error");
    assert.equal(createNode.mock.calls.length, 1);
  });

  it("copies with the true source name and does not submit configuration", async () => {
    const copyNode = vi.fn(async () => {});
    const operations = createOperations({
      getNodeConfigXml: vi.fn(async () => xml),
      getNodes: vi.fn(async () => []),
      copyNode
    });
    assert.equal((await operations.copyNode(environment, nodeUrl, "agent-copy")).status, "copied");
    assert.deepEqual(copyNode.mock.calls, [["agent", "agent-copy"]]);
  });

  it("rejects collisions and unsupported sources without create requests", async () => {
    const createNode = vi.fn(async () => {});
    const operations = createOperations({
      getNodes: vi.fn(async () => [
        { displayName: "new", name: "new", offline: true, temporarilyOffline: false }
      ]),
      createNode,
      getNodeConfigXml: vi.fn(async () => "<cloud><name>agent</name></cloud>")
    });
    await assert.rejects(
      operations.createNode(environment, {
        name: "new",
        remoteFS: "/tmp/new",
        numExecutors: 1,
        labels: "",
        mode: "NORMAL"
      }),
      /already exists/
    );
    await assert.rejects(
      operations.copyNode(environment, nodeUrl, "copy"),
      UnsupportedNodeConfigurationError
    );
    assert.equal(createNode.mock.calls.length, 0);
  });
});

describe("verified idle node", () => {
  it("requires complete consistent evidence including one-off work", () => {
    assert.equal(isNodeDefinitelyIdle(idleDetails()), true);
    assert.equal(isNodeDefinitelyIdle({ ...idleDetails(), busyExecutors: undefined }), true);
    for (const change of [
      { idle: undefined },
      { busyExecutors: 1 },
      { numExecutors: undefined },
      { executors: [] },
      { oneOffExecutors: undefined },
      { oneOffExecutors: [{ idle: false }] },
      { executors: [{ idle: true, currentExecutable: { building: true } }] }
    ]) {
      assert.equal(isNodeDefinitelyIdle({ ...idleDetails(), ...change }), false);
    }
  });
});

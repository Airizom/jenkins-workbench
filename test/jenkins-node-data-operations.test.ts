import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsNodeDataOperations } from "../src/jenkins/data/JenkinsNodeDataOperations";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example.com/"
};

function createOperations(client: JenkinsClient): JenkinsNodeDataOperations {
  const clientProvider = {
    getClient: async (): Promise<JenkinsClient> => client,
    getAuthSignature: async (): Promise<string> => "auth"
  } as unknown as JenkinsClientProvider;
  return new JenkinsNodeDataOperations(
    new JenkinsDataRuntimeContext(clientProvider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    })
  );
}

describe("JenkinsNodeDataOperations", () => {
  it.each([true, false])("sets temporarilyOffline=%s", async (targetOffline) => {
    const nodeUrl = `${environment.url}computer/agent-one/`;
    let temporarilyOffline = !targetOffline;
    const toggleNodeTemporarilyOffline = vi.fn(async () => {
      temporarilyOffline = targetOffline;
    });
    const client = {
      getNodeDetails: vi.fn(async () => ({
        displayName: "agent-one",
        offline: true,
        temporarilyOffline
      })),
      toggleNodeTemporarilyOffline
    } as unknown as JenkinsClient;
    const result = await createOperations(client).setNodeTemporarilyOffline(
      environment,
      nodeUrl,
      targetOffline,
      "maintenance"
    );

    assert.equal(result.status, "toggled");
    assert.equal(result.details.temporarilyOffline, targetOffline);
    assert.deepEqual(toggleNodeTemporarilyOffline.mock.calls, [
      [nodeUrl, targetOffline ? "maintenance" : undefined]
    ]);
  });

  it.each([true, false])(
    "serializes overlapping requests for temporarilyOffline=%s",
    async (targetOffline) => {
      const nodeUrl = `${environment.url}computer/agent-one/`;
      let temporarilyOffline = !targetOffline;
      const toggleNodeTemporarilyOffline = vi.fn(async () => {
        temporarilyOffline = !temporarilyOffline;
      });
      const operations = createOperations({
        getNodeDetails: vi.fn(async () => ({
          displayName: "agent-one",
          offline: temporarilyOffline,
          temporarilyOffline
        })),
        toggleNodeTemporarilyOffline
      } as unknown as JenkinsClient);

      const results = await Promise.all([
        operations.setNodeTemporarilyOffline(environment, nodeUrl, targetOffline),
        operations.setNodeTemporarilyOffline(environment, nodeUrl, targetOffline)
      ]);

      assert.equal(temporarilyOffline, targetOffline);
      assert.equal(toggleNodeTemporarilyOffline.mock.calls.length, 1);
      assert.deepEqual(
        results.map((result) => result.status),
        ["toggled", "no_change"]
      );
      for (const result of results) {
        assert.equal(result.details.temporarilyOffline, targetOffline);
      }
    }
  );

  it("continues queued requests after a toggle fails", async () => {
    const nodeUrl = `${environment.url}computer/agent-one/`;
    let temporarilyOffline = false;
    const toggleNodeTemporarilyOffline = vi
      .fn(async () => {
        temporarilyOffline = !temporarilyOffline;
      })
      .mockRejectedValueOnce(new Error("Toggle failed"));
    const operations = createOperations({
      getNodeDetails: vi.fn(async () => ({
        displayName: "agent-one",
        offline: temporarilyOffline,
        temporarilyOffline
      })),
      toggleNodeTemporarilyOffline
    } as unknown as JenkinsClient);

    const failed = assert.rejects(
      operations.setNodeTemporarilyOffline(environment, nodeUrl, true),
      /Toggle failed/
    );
    const queued = operations.setNodeTemporarilyOffline(environment, nodeUrl, true);
    await failed;
    assert.equal((await queued).status, "toggled");
    assert.equal(temporarilyOffline, true);
    assert.equal(toggleNodeTemporarilyOffline.mock.calls.length, 2);
  });
});

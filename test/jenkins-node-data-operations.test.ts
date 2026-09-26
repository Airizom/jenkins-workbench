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

describe("JenkinsNodeDataOperations", () => {
  it("takes a disconnected node temporarily offline", async () => {
    const nodeUrl = `${environment.url}computer/agent-one/`;
    let temporarilyOffline = false;
    const toggleNodeTemporarilyOffline = vi.fn(async () => {
      temporarilyOffline = true;
    });
    const client = {
      getNodeDetails: vi.fn(async () => ({
        displayName: "agent-one",
        offline: true,
        temporarilyOffline
      })),
      toggleNodeTemporarilyOffline
    } as unknown as JenkinsClient;
    const clientProvider = {
      getClient: async (): Promise<JenkinsClient> => client,
      getAuthSignature: async (): Promise<string> => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(clientProvider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });

    const result = await new JenkinsNodeDataOperations(context).setNodeTemporarilyOffline(
      environment,
      nodeUrl,
      true,
      "maintenance"
    );

    assert.equal(result.status, "toggled");
    assert.equal(result.details.temporarilyOffline, true);
    assert.deepEqual(toggleNodeTemporarilyOffline.mock.calls, [[nodeUrl, "maintenance"]]);
  });
});

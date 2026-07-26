import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsPendingInputDataOperations } from "../src/jenkins/data/JenkinsPendingInputDataOperations";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example.com/"
};

describe("JenkinsPendingInputDataOperations", () => {
  it("writes the pending-input summary once during a forced refresh", async () => {
    const buildUrl = "https://jenkins.example.com/job/demo/15/";
    const client = {
      getPendingInputActions: async () => [{ id: "approval", message: "Ready?" }]
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
    const summaryKey = await context.buildCacheKey(environment, "pending-input-summary", buildUrl);
    const setSpy = vi.spyOn(context.getCache(), "set");
    const operations = new JenkinsPendingInputDataOperations(context);

    const summary = await operations.refreshPendingInputSummary(environment, buildUrl);

    assert.equal(summary.awaitingInput, true);
    assert.equal(summary.count, 1);
    assert.equal(setSpy.mock.calls.filter(([key]) => key === summaryKey).length, 1);
  });
});

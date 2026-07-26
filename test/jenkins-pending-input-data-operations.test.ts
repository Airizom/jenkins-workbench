import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsPendingInputDataOperations } from "../src/jenkins/data/JenkinsPendingInputDataOperations";
import { JenkinsRequestError } from "../src/jenkins/errors";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example.com/"
};

describe("JenkinsPendingInputDataOperations", () => {
  it("writes the pending-input summary once during a forced refresh", async () => {
    const buildUrl = "https://jenkins.example.com/job/demo/15/";
    const client = {
      getPendingInputActions: async () => [
        { id: "approval-b", message: "Ready second?" },
        { id: "approval-a", message: "Ready first?" }
      ]
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
    assert.equal(summary.count, 2);
    assert.deepEqual(
      summary.inputs?.map((input) => input.message),
      ["Ready first?", "Ready second?"]
    );
    assert.deepEqual(
      summary.inputs?.map((input) => input.id),
      ["approval-a", "approval-b"]
    );
    assert.ok(summary.inputs?.[0]?.signature.includes('"id":"approval-a"'));
    assert.ok(summary.inputs?.[1]?.signature.includes('"id":"approval-b"'));
    assert.equal(summary.signature, summary.inputs?.map((input) => input.signature).join("|"));
    assert.equal(summary.availability, "supported");
    assert.equal(setSpy.mock.calls.filter(([key]) => key === summaryKey).length, 1);
  });

  it("preserves unsupported pending-input capability in refreshed summaries", async () => {
    const buildUrl = "https://jenkins.example.com/job/demo/16/";
    let calls = 0;
    const client = {
      getPendingInputActions: async () => {
        calls++;
        throw new JenkinsRequestError("Not found", 404);
      }
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
    const operations = new JenkinsPendingInputDataOperations(context);

    const first = await operations.refreshPendingInputSummary(environment, buildUrl);
    const second = await operations.refreshPendingInputSummary(environment, buildUrl);

    assert.equal(first.availability, "unsupported");
    assert.equal(first.awaitingInput, false);
    assert.equal(second.availability, "unsupported");
    assert.equal(calls, 1);
  });
});

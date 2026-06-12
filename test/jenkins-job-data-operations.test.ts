import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsParameterDefinition } from "../src/jenkins/types";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsJobDataOperations } from "../src/jenkins/data/JenkinsJobDataOperations";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example.com/"
};

describe("JenkinsJobDataOperations", () => {
  it("reloads job parameters after a successful config update", async () => {
    const jobUrl = "https://jenkins.example.com/job/demo/";
    const parameterRequests: string[] = [];
    let parameterDefinitions: JenkinsParameterDefinition[] = [
      { name: "oldValue", type: "StringParameterDefinition" }
    ];
    const client = {
      getJobParameters: async (requestedJobUrl: string): Promise<JenkinsParameterDefinition[]> => {
        parameterRequests.push(requestedJobUrl);
        return parameterDefinitions;
      },
      updateJobConfigXml: async (): Promise<void> => undefined
    } as unknown as JenkinsClient;
    const clientProvider = {
      getClient: async (): Promise<JenkinsClient> => client,
      getAuthSignature: async (): Promise<string> => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(clientProvider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      },
      cacheTtlMs: 300_000
    });
    const operations = new JenkinsJobDataOperations(context);

    const firstParameters = await operations.getJobParameters(environment, jobUrl);
    assert.equal(firstParameters[0]?.name, "oldValue");
    assert.equal(firstParameters[0]?.kind, "string");

    parameterDefinitions = [{ name: "newValue", type: "BooleanParameterDefinition" }];
    await operations.updateJobConfigXml(environment, jobUrl, "<project />");

    const secondParameters = await operations.getJobParameters(environment, jobUrl);
    assert.equal(secondParameters[0]?.name, "newValue");
    assert.equal(secondParameters[0]?.kind, "boolean");
    assert.deepEqual(parameterRequests, [jobUrl, jobUrl]);
  });
});

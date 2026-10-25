import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsJobsApi } from "../src/jenkins/client/JenkinsJobsApi";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsParameterDefinition } from "../src/jenkins/types";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsJobDataOperations } from "../src/jenkins/data/JenkinsJobDataOperations";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

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

  it("reads the next build number from Jenkins on every call", async () => {
    const jobUrl = "https://jenkins.example.com/job/demo/";
    let nextBuildNumber = 7;
    const requests: string[] = [];
    const client = {
      getNextBuildNumber: async (requestedJobUrl: string): Promise<number> => {
        requests.push(requestedJobUrl);
        return nextBuildNumber;
      }
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

    assert.equal(await operations.getNextBuildNumber(environment, jobUrl), 7);
    nextBuildNumber = 8;
    assert.equal(await operations.getNextBuildNumber(environment, jobUrl), 8);
    assert.deepEqual(requests, [jobUrl, jobUrl]);
  });
});

describe("JenkinsJobsApi.getNextBuildNumber", () => {
  function createApi(response: unknown, requestedUrls: string[] = []): JenkinsJobsApi {
    return new JenkinsJobsApi(
      createJenkinsClientContext({
        requestJson: async <T>(url: string): Promise<T> => {
          requestedUrls.push(url);
          return response as T;
        }
      })
    );
  }

  it("requests only nextBuildNumber", async () => {
    const requestedUrls: string[] = [];
    const api = createApi({ nextBuildNumber: 42 }, requestedUrls);

    assert.equal(await api.getNextBuildNumber("https://jenkins.example.com/job/demo/"), 42);
    assert.equal(requestedUrls.length, 1);
    const url = new URL(requestedUrls[0]);
    assert.equal(url.pathname, "/job/demo/api/json");
    assert.equal(url.searchParams.get("tree"), "nextBuildNumber");
  });

  it.each([
    {},
    { nextBuildNumber: 0 },
    { nextBuildNumber: -3 },
    { nextBuildNumber: 1.5 },
    {
      nextBuildNumber: "4"
    },
    null
  ])("rejects an invalid response: %o", async (response) => {
    await assert.rejects(
      createApi(response).getNextBuildNumber("https://jenkins.example.com/job/demo/"),
      /invalid next build number/
    );
  });
});

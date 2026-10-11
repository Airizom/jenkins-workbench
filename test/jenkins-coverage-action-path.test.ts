import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import { JenkinsCoverageDataOperations } from "../src/jenkins/data/JenkinsCoverageDataOperations";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";

const environment = {
  environmentId: "env-1",
  scope: "workspace" as const,
  url: "https://jenkins.example.com/"
};
const buildUrl = `${environment.url}job/demo/1/`;

describe("coverage action path normalization", () => {
  it.each([
    { input: undefined, expected: "coverage" },
    { input: "", expected: "coverage" },
    { input: "   ", expected: "coverage" },
    { input: "///", expected: "coverage" },
    { input: "/coverage/", expected: "coverage" },
    { input: " //custom-coverage// ", expected: "custom-coverage" },
    { input: "a/b", expected: "a/b" }
  ])("normalizes $input to $expected", async ({ input, expected }) => {
    const getCoverageOverview = vi.fn(async () => ({ metrics: [] }));
    const client = { getCoverageOverview } as unknown as JenkinsClient;
    const provider = {
      getClient: async () => client,
      getAuthSignature: async () => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(provider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });

    await new JenkinsCoverageDataOperations(context).getCoverageOverview(environment, buildUrl, {
      actionPath: input
    });

    assert.deepEqual(getCoverageOverview.mock.calls, [[buildUrl, expected]]);
  });
});

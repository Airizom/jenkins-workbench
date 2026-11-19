import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import { JenkinsBuildDataOperations } from "../src/jenkins/data/JenkinsBuildDataOperations";
import { JenkinsCoverageDataOperations } from "../src/jenkins/data/JenkinsCoverageDataOperations";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { JenkinsJobDataOperations } from "../src/jenkins/data/JenkinsJobDataOperations";
import { JenkinsNodeDataOperations } from "../src/jenkins/data/JenkinsNodeDataOperations";
import { JenkinsPendingInputDataOperations } from "../src/jenkins/data/JenkinsPendingInputDataOperations";

const environment = {
  environmentId: "env-1",
  scope: "workspace" as const,
  url: "https://jenkins.example.com/"
};
const url = `${environment.url}job/demo/`;
const cases = [
  {
    name: "node list refresh",
    method: "getNodes",
    values: [[{ displayName: "old" }], [{ displayName: "new" }]],
    load: (context: JenkinsDataRuntimeContext, refresh: boolean) =>
      new JenkinsNodeDataOperations(context).getNodes(environment, {
        mode: refresh ? "refresh" : "cached"
      })
  },
  {
    name: "node details",
    method: "getNodeDetails",
    values: [
      { displayName: "old", offline: true },
      { displayName: "new", offline: false }
    ],
    load: (context: JenkinsDataRuntimeContext, refresh: boolean) =>
      new JenkinsNodeDataOperations(context).getNodeDetails(environment, url, {
        mode: refresh ? "refresh" : undefined
      })
  },
  {
    name: "folder refresh",
    method: "getFolderJobs",
    values: [[{ name: "old", url }], [{ name: "new", url }]],
    load: (context: JenkinsDataRuntimeContext, refresh: boolean) =>
      new JenkinsJobDataOperations(context).getJobsForFolder(environment, url, {
        mode: refresh ? "refresh" : "cached"
      })
  },
  {
    name: "completed build details",
    method: "getBuildDetails",
    values: [
      { number: 1, building: true },
      { number: 1, building: false }
    ],
    load: (context: JenkinsDataRuntimeContext, refresh: boolean) =>
      new JenkinsBuildDataOperations(context).getBuildDetails(environment, url, {
        bypassCache: refresh
      })
  },
  {
    name: "completed build coverage",
    method: "getCoverageOverview",
    values: [{ metrics: [] }, { metrics: [{ name: "LINE", covered: 10, missed: 0 }] }],
    load: (context: JenkinsDataRuntimeContext, _refresh: boolean) =>
      new JenkinsCoverageDataOperations(context).getCoverageOverview(environment, url, {
        buildCompleted: true
      })
  },
  {
    name: "pending input summary",
    method: "getPendingInputActions",
    values: [[{ id: "old", message: "Old input" }], [{ id: "new", message: "New input" }]],
    load: (context: JenkinsDataRuntimeContext, refresh: boolean) =>
      new JenkinsPendingInputDataOperations(context).getPendingInputSummary(environment, url, {
        mode: refresh ? "refresh" : "cached"
      })
  }
];

describe("asynchronous data cache invalidation", () => {
  it("does not inherit an earlier run's unsupported workflow at the same numbered URL", async () => {
    const buildUrl = `${url}7/`;
    const workflow = { stages: [{ name: "replacement" }] };
    const unavailable = new JenkinsRequestError("No workflow", 404);
    const getWorkflowRun = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(workflow);
    const builds = new JenkinsBuildDataOperations(
      new JenkinsDataRuntimeContext(
        {
          getClient: async () => ({ getWorkflowRun }),
          getAuthSignature: async () => "auth"
        } as unknown as JenkinsClientProvider,
        {
          buildParameterRequestPreparer: {
            prepareBuildParameters: async () => ({ hasParameters: false })
          }
        }
      )
    );
    // A different consumer previously looked up this build by URL alone.
    assert.equal(await builds.getWorkflowRun(environment, buildUrl), undefined);
    const previous = { queueId: 17, result: "SUCCESS" };
    assert.equal(await builds.getWorkflowRun(environment, buildUrl, previous), undefined);
    assert.equal(await builds.getWorkflowRun(environment, buildUrl, previous), undefined);
    assert.equal(getWorkflowRun.mock.calls.length, 2);
    assert.deepEqual(await builds.getWorkflowRun(environment, buildUrl, {}), workflow);
    assert.deepEqual(
      await builds.getWorkflowRun(environment, buildUrl, { queueId: 18, result: "SUCCESS" }),
      workflow
    );
    assert.equal(getWorkflowRun.mock.calls.length, 4);
  });

  it.each([true, false])(
    "caches only confirmed terminal build details (statusOnly=%s)",
    async (statusOnly) => {
      const buildUrl = `${url}7/`;
      const partial = { number: 7, url: buildUrl };
      const completed = { ...partial, building: false, result: "SUCCESS" };
      const request = vi
        .fn()
        .mockResolvedValueOnce({ ...partial, building: true })
        .mockResolvedValueOnce(partial)
        .mockResolvedValueOnce(completed);
      const provider = {
        getClient: async () => ({ getBuildDetails: request }),
        getAuthSignature: async () => "auth"
      } as unknown as JenkinsClientProvider;
      const builds = new JenkinsBuildDataOperations(
        new JenkinsDataRuntimeContext(provider, {
          buildParameterRequestPreparer: {
            prepareBuildParameters: async () => ({ hasParameters: false })
          }
        })
      );
      const read = () => builds.getBuildDetails(environment, buildUrl, { statusOnly });
      assert.equal((await read()).building, true);
      assert.deepEqual(await read(), partial);
      assert.deepEqual(await read(), completed);
      assert.deepEqual(await read(), completed);
      assert.equal(request.mock.calls.length, 3);
    }
  );

  it.each(cases)("preserves newer data after an invalidated $name finishes", async (testCase) => {
    let release!: (value: unknown) => void;
    let started!: () => void;
    const response = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const request = vi
      .fn(async (): Promise<unknown> => testCase.values[1])
      .mockImplementationOnce(() => {
        started();
        return response;
      });
    const client = {
      [testCase.method]: request,
      classifyJob: () => "job"
    } as unknown as JenkinsClient;
    const provider = {
      getClient: async () => client,
      getAuthSignature: async () => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(provider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });

    const oldRequest = testCase.load(context, true);
    await requestStarted;
    context.clearCacheForEnvironment(environment.environmentId);
    const newValue = await testCase.load(context, true);
    release(testCase.values[0]);
    await oldRequest;

    assert.deepEqual(await testCase.load(context, false), newValue);
    assert.equal(request.mock.calls.length, 2);
  });
});

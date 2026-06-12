import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { JenkinsClient, JenkinsJob, JenkinsJobKind } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsDataCache } from "../src/jenkins/data/JenkinsDataCache";
import { JenkinsJobIndex } from "../src/jenkins/data/JenkinsJobIndex";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example.com/"
};

type TestJob = JenkinsJob & { kind: JenkinsJobKind };

const job = (name: string, url: string, kind: JenkinsJobKind): TestJob => ({
  name,
  url,
  kind
});

describe("JenkinsJobIndex", () => {
  it("stops queued folder traversal when a streaming consumer returns early", async () => {
    const rootFolderUrl = "https://jenkins.example.com/job/root/";
    const unvisitedFolderUrl = "https://jenkins.example.com/job/root/job/unvisited/";
    const folderRequests: string[] = [];
    const folderJobs = new Map<string, JenkinsJob[]>([
      [
        rootFolderUrl,
        [
          job("leaf", "https://jenkins.example.com/job/root/job/leaf/", "job"),
          job("unvisited", unvisitedFolderUrl, "folder")
        ]
      ],
      [unvisitedFolderUrl, [job("late", `${unvisitedFolderUrl}job/late/`, "job")]]
    ]);

    const client = {
      getRootJobs: async (): Promise<JenkinsJob[]> => [job("root", rootFolderUrl, "folder")],
      getFolderJobs: async (folderUrl: string): Promise<JenkinsJob[]> => {
        folderRequests.push(folderUrl);
        return folderJobs.get(folderUrl) ?? [];
      },
      classifyJob: (jenkinsJob: JenkinsJob): JenkinsJobKind => (jenkinsJob as TestJob).kind
    } as unknown as JenkinsClient;
    const clientProvider = {
      getClient: async (): Promise<JenkinsClient> => client,
      getAuthSignature: async (): Promise<string> => "auth"
    } as unknown as JenkinsClientProvider;
    const index = new JenkinsJobIndex(new JenkinsDataCache(), clientProvider);

    const iterator = index
      .iterateJobsForEnvironment(environment, {
        mode: "refresh",
        batchSize: 1,
        concurrency: 1,
        backoffBaseMs: 0,
        backoffMaxMs: 0,
        maxRetries: 0
      })
      [Symbol.asyncIterator]();

    const first = await iterator.next();
    assert.equal(first.done, false);
    assert.equal(first.value[0]?.name, "leaf");

    await iterator.return?.();
    await setImmediate();

    assert.deepEqual(folderRequests, [rootFolderUrl]);
  });
});

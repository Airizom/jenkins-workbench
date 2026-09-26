import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import type { JenkinsClient, JenkinsJob, JenkinsJobKind } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { CancellationError } from "../src/jenkins/errors";
import { JenkinsDataCache } from "../src/jenkins/data/JenkinsDataCache";
import { JenkinsJobIndex } from "../src/jenkins/data/JenkinsJobIndex";
import { JenkinsDataServiceReader } from "../src/jenkins/JenkinsDataServiceReader";

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
  it("uses the configured TTL and reloads jobs when caching is disabled", async () => {
    let now = 1_000;
    let rootJobs: JenkinsJob[] = [job("first", "https://jenkins.example.com/job/first/", "job")];
    let rootRequests = 0;
    const client = {
      getRootJobs: async (): Promise<JenkinsJob[]> => {
        rootRequests += 1;
        return rootJobs;
      },
      classifyJob: (jenkinsJob: JenkinsJob): JenkinsJobKind => (jenkinsJob as TestJob).kind
    } as unknown as JenkinsClient;
    const clientProvider = {
      getClient: async (): Promise<JenkinsClient> => client,
      getAuthSignature: async (): Promise<string> => "auth"
    } as unknown as JenkinsClientProvider;
    const reader = new JenkinsDataServiceReader(clientProvider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      },
      cacheTtlMs: 100
    });
    const readNames = async (): Promise<string[]> =>
      (await reader.getAllJobsForEnvironment(environment)).map((entry) => entry.name);
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      assert.deepEqual(await readNames(), ["first"]);
      rootJobs = [job("second", "https://jenkins.example.com/job/second/", "job")];
      now = 1_099;
      assert.deepEqual(await readNames(), ["first"]);
      now = 1_100;
      assert.deepEqual(await readNames(), ["second"]);
      assert.equal(rootRequests, 2);

      reader.updateCacheTtlMs(0);
      rootJobs = [job("third", "https://jenkins.example.com/job/third/", "job")];
      assert.deepEqual(await readNames(), ["third"]);
      rootJobs = [job("fourth", "https://jenkins.example.com/job/fourth/", "job")];
      assert.deepEqual(await readNames(), ["fourth"]);
      assert.equal(rootRequests, 4);
    } finally {
      dateNow.mockRestore();
    }
  });

  it.each([true, false])(
    "rejects an already-cancelled search with a %s cache entry",
    async (complete) => {
      const cache = new JenkinsDataCache();
      const entry = {
        name: "cached",
        url: "https://jenkins.example.com/job/cached/",
        kind: "job" as const,
        fullName: "cached",
        path: [
          { name: "cached", url: "https://jenkins.example.com/job/cached/", kind: "job" as const }
        ]
      };
      cache.set(cache.buildKey(environment, "job-index", undefined, "auth"), {
        entries: [entry],
        complete
      });
      const clientProvider = {
        getAuthSignature: async (): Promise<string> => "auth",
        getClient: async (): Promise<never> => {
          throw new Error("Cached search should not request a client");
        }
      } as unknown as JenkinsClientProvider;
      const index = new JenkinsJobIndex(cache, clientProvider);
      const batches: unknown[] = [];

      await assert.rejects(async () => {
        for await (const batch of index.iterateJobsForEnvironment(environment, {
          cancellation: { isCancellationRequested: true },
          maxResults: 1
        })) {
          batches.push(batch);
        }
      }, CancellationError);
      assert.deepEqual(batches, []);
    }
  );

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

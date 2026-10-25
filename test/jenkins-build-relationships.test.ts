import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { JenkinsBuildRelationships } from "../src/jenkins/data/JenkinsBuildRelationships";
import { JenkinsRelationshipsApi } from "../src/jenkins/client/JenkinsRelationshipsApi";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuild, JenkinsJob } from "../src/jenkins/types";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env",
  scope: "workspace",
  url: "https://jenkins.example/jenkins/"
};
const job = (name: string, folder = false): JenkinsJob => ({
  name,
  url: `${environment.url}job/${name}/`,
  _class: folder ? "folder" : "job"
});
const source = `${job("parent").url}42/`;
const child = (name = "child", number = 1, parent = "parent", parentNumber = 42): JenkinsBuild => ({
  number,
  url: `${job(name).url}${number}/`,
  result: "SUCCESS",
  building: false,
  actions: [{ causes: [{ upstreamUrl: `job/${parent}/`, upstreamBuild: parentNumber }] }]
});
function harness(overrides: Partial<JenkinsClient> = {}) {
  const client = {
    getRootJobs: vi.fn(async () => [] as JenkinsJob[]),
    getDownstreamProjects: vi.fn(async () => [] as JenkinsJob[]),
    getFolderJobs: vi.fn(async () => [] as JenkinsJob[]),
    getRelationshipBuilds: vi.fn(async () => [] as JenkinsBuild[]),
    getRelationshipJobs: (url: string) =>
      url === environment.url ? client.getRootJobs() : client.getFolderJobs(url),
    classifyJob: (value: JenkinsJob) => (value._class === "folder" ? "folder" : "job"),
    ...overrides
  } as unknown as JenkinsClient;
  const downstream = client.getDownstreamProjects.bind(client);
  client.getDownstreamProjects = async (...args) => {
    args[2]?.();
    return downstream(...args);
  };
  const jobs = client.getRelationshipJobs.bind(client);
  client.getRelationshipJobs = async (...args) => {
    args[2]?.();
    return jobs(...args);
  };
  const builds = client.getRelationshipBuilds.bind(client);
  client.getRelationshipBuilds = async (...args) => {
    args[3]?.();
    return builds(...args);
  };
  return { client, service: new JenkinsBuildRelationships({ getClient: async () => client }) };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => vi.useRealTimers());

describe("downstream build discovery", () => {
  it("prioritizes configured jobs, deduplicates jobs, and requires exact direct causes", async () => {
    const requested: string[] = [];
    const { service } = harness({
      getDownstreamProjects: async () => [job("child")],
      getRootJobs: async () => [job("child"), job("other"), job("excluded")],
      getRelationshipBuilds: async (url) => {
        requested.push(url);
        return url === job("child").url
          ? [
              child(),
              child("child", 2),
              child("child", 3, "different"),
              child("child", 4, "parent", 43),
              {
                number: 5,
                url: `${url}5/`,
                actions: [
                  {
                    causes: [
                      {
                        upstreamUrl: "job/indirect/",
                        upstreamBuild: 7,
                        upstreamCauses: [{ upstreamUrl: "job/parent/", upstreamBuild: 42 }]
                      } as never
                    ]
                  }
                ]
              }
            ]
          : [child("other")];
      }
    });
    const result = await service.getDownstreamBuilds(environment, source, { maxJobs: 2 });
    assert.deepEqual(requested, [job("child").url, job("other").url]);
    assert.deepEqual(
      result.builds.map((entry) => [entry.jobName, entry.number]),
      [
        ["child", 2],
        ["child", 1],
        ["other", 1]
      ]
    );
    assert.equal(result.jobsSearched, 2);
    assert.equal(result.buildsSearched, 6);
    assert.ok(result.partialReasons.some((reason) => reason.includes("2-job")));
  });

  it("traverses folders and ignores foreign candidate and returned build URLs", async () => {
    const { service } = harness({
      getRootJobs: async () => [
        job("folder", true),
        { ...job("foreign"), url: "https://other.example/job/x/" }
      ],
      getFolderJobs: async () => [job("child")],
      getRelationshipBuilds: async () => [
        child(),
        { ...child("other"), number: 2 },
        { ...child(), url: "https://other.example/job/child/1/" }
      ]
    });
    const result = await service.getDownstreamBuilds(environment, source);
    assert.equal(result.builds.length, 1);
    assert.equal(result.requestsMade, 4);
  });

  it("uses separate paged history and finds matches beyond the first 100 builds", async () => {
    const offsets: number[] = [];
    const { service } = harness({
      getDownstreamProjects: async () => [job("child")],
      getRelationshipBuilds: async (_url, offset, limit) => {
        offsets.push(offset);
        assert.equal(limit, 100);
        return offset === 0
          ? Array.from({ length: 100 }, (_, index) => child("child", index + 2, "elsewhere"))
          : [child()];
      }
    });
    const result = await service.getDownstreamBuilds(environment, source, { maxBuildsPerJob: 300 });
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(result.builds.length, 1);
    assert.equal(result.buildsSearched, 101);
  });

  it("reports history limits and retains matches when other jobs fail", async () => {
    const { service } = harness({
      getRootJobs: async () => [job("child"), job("forbidden")],
      getRelationshipBuilds: async (url) => {
        if (url === job("forbidden").url) throw new Error("403");
        return [child()];
      }
    });
    const result = await service.getDownstreamBuilds(environment, source, { maxBuildsPerJob: 1 });
    assert.equal(result.builds.length, 1);
    assert.ok(result.partialReasons.some((reason) => reason.includes("1-build")));
    assert.ok(result.partialReasons.some((reason) => reason.includes("Unable to read")));
  });

  it("never exceeds four concurrent endpoint calls or the 100-request budget", async () => {
    let active = 0;
    let maxActive = 0;
    const { service } = harness({
      getRootJobs: async () => Array.from({ length: 200 }, (_, index) => job(`child${index}`)),
      getRelationshipBuilds: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await tick();
        active--;
        return [];
      }
    });
    const result = await service.getDownstreamBuilds(environment, source, { maxJobs: 200 });
    assert.equal(result.requestsMade, 100);
    assert.equal(maxActive, 4);
    assert.equal(result.jobsSearched, 98);
    assert.ok(result.partialReasons.some((reason) => reason.includes("100-request")));
  });

  it("counts authentication retries against the same request budget", async () => {
    let retries = 0;
    const { service } = harness({
      getRootJobs: async () => Array.from({ length: 150 }, (_, index) => job(`child${index}`)),
      getRelationshipBuilds: async (_url, _offset, _limit, beforeRequest) => {
        beforeRequest?.();
        retries++;
        return [];
      }
    });
    const result = await service.getDownstreamBuilds(environment, source, { maxJobs: 200 });
    assert.equal(result.requestsMade, 100);
    assert.equal(retries, 49);
    assert.equal(result.jobsSearched, 49);
  });

  it("reserves request budget for matches when traversing many empty folders", async () => {
    const { service } = harness({
      getDownstreamProjects: async () => [job("child")],
      getRootJobs: async () =>
        Array.from({ length: 100 }, (_, index) => job(`folder${index}`, true)),
      getRelationshipBuilds: async () => [child()]
    });
    const result = await service.getDownstreamBuilds(environment, source);
    assert.equal(result.builds.length, 1);
    assert.ok(result.requestsMade < 100);
    assert.ok(result.partialReasons.some((reason) => reason.includes("enumeration")));
  });

  it("returns promptly on cancellation and ignores late endpoint results", async () => {
    let release!: (builds: JenkinsBuild[]) => void;
    const { service } = harness({
      getRootJobs: async () => [job("child")],
      getRelationshipBuilds: async () =>
        new Promise((resolve) => {
          release = resolve;
        })
    });
    const cancellation = new AbortController();
    const pending = service.getDownstreamBuilds(environment, source, {
      signal: cancellation.signal
    });
    await tick();
    cancellation.abort();
    const result = await pending;
    assert.deepEqual(result.builds, []);
    assert.ok(result.partialReasons.includes("Search cancelled."));
    release([child()]);
    await tick();
    assert.deepEqual(result.builds, []);
    assert.equal(result.buildsSearched, 0);
  });

  it("publishes a partial snapshot at the deadline even when an endpoint is pending", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { service } = harness({
      getDownstreamProjects: async (_url, _limit, _beforeRequest, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => {});
      }
    });
    const pending = service.getDownstreamBuilds(environment, source);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;
    assert.equal(result.requestsMade, 1);
    assert.ok(result.partialReasons.some((reason) => reason.includes("deadline")));
    assert.equal(signal?.aborted, true);
  });

  it("inspects configured children before a stalled fallback list consumes the deadline", async () => {
    vi.useFakeTimers();
    const { service } = harness({
      getDownstreamProjects: async () => [job("child")],
      getRelationshipBuilds: async () => [child()],
      getRootJobs: async () => new Promise(() => {})
    });
    const pending = service.getDownstreamBuilds(environment, source);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;
    assert.equal(result.builds.length, 1);
    assert.equal(result.jobsSearched, 1);
    assert.ok(result.partialReasons.some((reason) => reason.includes("deadline")));
  });

  it("does not request invalid targets or already-cancelled searches", async () => {
    const { service, client } = harness();
    assert.equal(
      (await service.getDownstreamBuilds(environment, "https://evil.example/job/a/1/"))
        .requestsMade,
      0
    );
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      (await service.getDownstreamBuilds(environment, source, { signal: controller.signal }))
        .requestsMade,
      0
    );
    assert.equal(vi.mocked(client.getRootJobs).mock.calls.length, 0);
  });

  it("reports client initialization failure as a recoverable search failure", async () => {
    const service = new JenkinsBuildRelationships({
      getClient: async () => {
        throw new Error("offline");
      }
    });
    assert.ok(
      (await service.getDownstreamBuilds(environment, source)).partialReasons.some((reason) =>
        reason.includes("connection")
      )
    );
  });
});

describe("relationship API projections", () => {
  it("requests minimal allBuilds ranges and configured downstream projects", async () => {
    const urls: string[] = [];
    const api = new JenkinsRelationshipsApi(
      createJenkinsClientContext({
        requestJson: async <T>(url: string) => {
          urls.push(url);
          return { allBuilds: [child()], downstreamProjects: [job("child")] } as T;
        }
      })
    );
    assert.equal((await api.getRelationshipBuilds(job("child").url, 100, 25)).length, 1);
    assert.equal((await api.getDownstreamProjects(job("parent").url)).length, 1);
    assert.equal(
      new URL(urls[0]).searchParams.get("tree"),
      "allBuilds[number,url,result,building,timestamp,actions[causes[upstreamProject,upstreamUrl,upstreamBuild]]]{100,125}"
    );
    assert.equal(
      new URL(urls[1]).searchParams.get("tree"),
      "downstreamProjects[name,url,_class]{0,201}"
    );
    await api.getRelationshipJobs(environment.url, 51);
    assert.equal(new URL(urls[2]).searchParams.get("tree"), "jobs[name,url,_class]{0,51}");
  });
});

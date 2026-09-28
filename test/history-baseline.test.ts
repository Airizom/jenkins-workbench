import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { HistoryBaselineResolver, HistoryBaselineStore } from "../src/history/HistoryBaseline";
import { HistoryService } from "../src/history/HistoryService";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";

const environment = {
  environmentId: "e",
  scope: "workspace" as const,
  url: "https://jenkins.test/"
};
function state() {
  const entries = new Map<string, unknown>();
  return {
    get: (key: string, fallback: unknown) => entries.get(key) ?? fallback,
    update: async (key: string, value: unknown) => {
      entries.set(key, value);
    }
  };
}
describe("historical baseline", () => {
  it("keeps global and workspace overrides separate and can reset them", async () => {
    const store = new HistoryBaselineStore({
      workspaceState: state(),
      globalState: state()
    } as unknown as vscode.ExtensionContext);
    await store.set(environment, "https://jenkins.test/job/p/", "https://jenkins.test/job/a/");
    expect(
      store.get({ ...environment, scope: "global" }, "https://jenkins.test/job/p/")
    ).toBeUndefined();
    await store.set(environment, "https://jenkins.test/job/p/", undefined);
    expect(store.get(environment, "https://jenkins.test/job/p/")).toBeUndefined();
  });
  it("selects latest completion before the target start, rather than newest build number", async () => {
    const store = new HistoryBaselineStore({
      workspaceState: state(),
      globalState: state()
    } as unknown as vscode.ExtensionContext);
    const getTestReport = vi.fn().mockResolvedValue(undefined);
    const data = {
      getJobInfo: async () => ({ kind: "multibranch" }),
      getJobsForFolder: async () => [{ name: "main", url: "https://jenkins.test/job/p/job/main/" }],
      getJob: async () => ({ name: "main" }),
      getBuildsForJob: async () => [
        {
          number: 3,
          url: "https://jenkins.test/job/p/job/main/3/",
          result: "FAILURE",
          timestamp: 900,
          duration: 200
        },
        {
          number: 2,
          url: "https://jenkins.test/job/p/job/main/2/",
          result: "SUCCESS",
          timestamp: 700,
          duration: 100
        },
        {
          number: 1,
          url: "https://jenkins.test/job/p/job/main/1/",
          result: "FAILURE",
          timestamp: 500,
          duration: 450
        }
      ],
      getTestReport
    } as unknown as JenkinsDataService;
    const resolver = new HistoryBaselineResolver(data, new HistoryService(data), store);
    const result = await resolver.resolve(
      {
        environment,
        jobUrl: "https://jenkins.test/job/p/job/feature/",
        count: 20,
        active: () => true
      },
      { number: 5, url: "https://jenkins.test/job/p/job/feature/5/", timestamp: 1000 }
    );
    expect(result.build?.number).toBe(1);
    expect(result.status).toBe("unavailable");
    expect(result.automatic).toBe(true);
    expect(result.custom).toBeUndefined();
    expect(getTestReport).toHaveBeenCalledTimes(1);
    await store.set(
      environment,
      "https://jenkins.test/job/p/",
      "https://jenkins.test/job/p/job/main/"
    );
    const custom = await resolver.resolve(
      {
        environment,
        jobUrl: "https://jenkins.test/job/p/job/feature/",
        count: 20,
        active: () => true
      },
      { number: 5, url: "https://jenkins.test/job/p/job/feature/5/", timestamp: 1000 }
    );
    expect(custom.custom).toBe(true);
    expect(custom.automatic).toBeUndefined();
  });
  it("keeps the custom flag when the chosen baseline job fails so it can be reset", async () => {
    const store = new HistoryBaselineStore({
      workspaceState: state(),
      globalState: state()
    } as unknown as vscode.ExtensionContext);
    await store.set(environment, "https://jenkins.test/job/a/", "https://jenkins.test/job/gone/");
    const data = {
      getJob: async () => {
        throw new Error("404");
      }
    } as unknown as JenkinsDataService;
    const resolver = new HistoryBaselineResolver(data, new HistoryService(data), store);
    const result = await resolver.resolve(
      { environment, jobUrl: "https://jenkins.test/job/a/", count: 20, active: () => true },
      { number: 5, url: "https://jenkins.test/job/a/5/", timestamp: 1000 }
    );
    expect(result).toMatchObject({
      status: "error",
      custom: true,
      jobUrl: "https://jenkins.test/job/gone/"
    });
  });
  describe("resolver outcomes", () => {
    const jobUrl = "https://jenkins.test/job/a/";
    const target = { number: 5, url: "https://jenkins.test/job/a/5/", timestamp: 1000 };
    async function resolve(
      options: {
        baseline?: string;
        builds?: unknown[];
        active?: () => boolean;
        target?: typeof target | { number: number; url: string };
      } = {}
    ) {
      const store = new HistoryBaselineStore({
        workspaceState: state(),
        globalState: state()
      } as unknown as vscode.ExtensionContext);
      if (options.baseline) await store.set(environment, jobUrl, options.baseline);
      const data = {
        getJobInfo: async () => ({ kind: "freestyle" }),
        getJob: async () => ({ name: "main" }),
        getBuildsForJob: async () => options.builds ?? [],
        getTestReport: vi.fn().mockResolvedValue(undefined)
      } as unknown as JenkinsDataService;
      const resolver = new HistoryBaselineResolver(data, new HistoryService(data), store);
      return resolver.resolve(
        { environment, jobUrl, count: 20, active: options.active ?? (() => true) },
        options.target ?? target
      );
    }
    it("stays unavailable when inactive or unconfigured", async () => {
      expect(await resolve({ active: () => false })).toEqual({ status: "unavailable" });
      expect(await resolve()).toEqual({
        status: "unavailable",
        message: "Select a baseline job."
      });
    });
    it("reports when the job is its own baseline", async () => {
      expect(await resolve({ baseline: jobUrl })).toMatchObject({
        status: "self",
        custom: true,
        jobUrl
      });
    });
    it("needs a target start time and an earlier completed build", async () => {
      const baseline = "https://jenkins.test/job/main/";
      expect(await resolve({ baseline, target: { number: 5, url: target.url } })).toMatchObject({
        status: "unavailable",
        label: "main",
        message: "Build start time unavailable."
      });
      expect(
        await resolve({
          baseline,
          builds: [
            { number: 1, url: `${baseline}1/`, result: "SUCCESS", timestamp: 990, duration: 50 },
            { number: 2, url: `${baseline}2/`, building: true, timestamp: 100 }
          ]
        })
      ).toMatchObject({
        status: "unavailable",
        truncated: false,
        message: "No baseline build completed before this build started."
      });
    });
  });
});

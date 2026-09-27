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
    expect(getTestReport).toHaveBeenCalledTimes(1);
  });
});

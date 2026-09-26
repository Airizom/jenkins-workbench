import { describe, expect, it, vi } from "vitest";
import {
  CurrentBranchCommitHistory,
  assessCommit
} from "../src/currentBranch/CurrentBranchCommitHistory";
import {
  currentCommitLabel,
  currentCommitTooltip
} from "../src/currentBranch/CurrentBranchCommitPresentation";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { CurrentBranchState } from "../src/currentBranch/CurrentBranchTypes";

const environment = { environmentId: "ci", scope: "workspace" as const, url: "https://ci.test" };
const head = "a".repeat(40);
const checkout = { head, dirty: false, repositories: ["github.com/team/app"] };
const build = {
  number: 60,
  url: "https://ci.test/job/app/60/",
  result: "SUCCESS",
  building: false,
  actions: [{ lastBuiltRevision: { SHA1: head }, remoteUrls: ["git@github.com:team/app.git"] }]
};

describe("commit history reads", () => {
  it("coalesces concurrent reads and preserves a verified match if old last-pass details fail", async () => {
    const data = {
      getJob: vi.fn(async () => ({
        name: "app",
        url: "https://ci.test/job/app/",
        lastSuccessfulBuild: { number: 1, url: "https://ci.test/job/app/1/" }
      })),
      getBuildsForJob: vi.fn(async () => [build]),
      getBuildDetails: vi.fn(async () => {
        throw new Error("deleted");
      })
    };
    const reader = new CurrentBranchCommitHistory(data as unknown as JenkinsDataService);
    const [one, two] = await Promise.all([
      reader.load(environment, "job"),
      reader.load(environment, "job")
    ]);
    expect(one).toBe(two);
    expect(data.getJob).toHaveBeenCalledTimes(1);
    expect(data.getBuildsForJob).toHaveBeenCalledWith(environment, "job", 50, {
      detailLevel: "revisions",
      bypassCache: true
    });
    expect(one.lastPassError).toContain("#1");
    expect(assessCommit(one, checkout).current?.build).toEqual(build);
    await reader.load(environment, "job");
    expect(data.getJob).toHaveBeenCalledTimes(2);
  });

  it("preserves job status when revision history fails", async () => {
    const job = { name: "app", url: "https://ci.test/job/app/", lastBuild: build };
    const data = {
      getJob: async () => job,
      getBuildsForJob: async () => {
        throw new Error("forbidden");
      }
    };
    const history = await new CurrentBranchCommitHistory(
      data as unknown as JenkinsDataService
    ).load(environment, job.url);
    expect(history.job).toBe(job);
    expect(assessCommit(history, checkout).kind).toBe("unverified");
  });
});

describe("commit presentation", () => {
  function state(): Extract<CurrentBranchState, { kind: "matched" }> {
    const history = {
      job: { name: "app", url: "https://ci.test/job/app/", inQueue: true },
      builds: [build],
      lastPass: build
    };
    return {
      kind: "matched",
      checkout: { ...checkout, dirty: true, upstream: "origin/main", ahead: 2, behind: 0 },
      commit: assessCommit(history, checkout),
      history,
      environment,
      repository: {
        repositoryUriString: "file:///app",
        repositoryLabel: "app",
        repositoryPath: "/app"
      },
      branchName: "main",
      jobName: "app",
      jobUrl: history.job.url,
      resolvedTargetKind: "branch",
      link: {
        repositoryUri: "file:///app",
        environment: { environmentId: "ci", scope: "workspace" },
        multibranchFolderUrl: "https://ci.test/job/",
        multibranchLabel: "app"
      },
      lastBuild: build
    };
  }

  it("shows local qualifiers without replacing commit results and keeps queue context job-level", () => {
    expect(currentCommitLabel(state())).toBe(
      "aaaaaaa passed · #60 · local changes untested · 2 commits ahead of upstream"
    );
    expect(currentCommitTooltip(state())).toContain("Job queued · commit not yet verified");
  });

  it("never presents a green job as verified when metadata or checkout state is unavailable", () => {
    const value = state();
    value.commit = { kind: "unverified", reason: "No remote" };
    expect(currentCommitLabel(value)).toContain("Build passed · revision unverified");
    value.commit = undefined;
    expect(currentCommitLabel(value)).toBe("Checking current commit");
  });
});

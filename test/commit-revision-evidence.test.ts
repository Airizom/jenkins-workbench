import { describe, expect, it } from "vitest";
import {
  assessBuildRevision,
  normalizeRepositoryUrl
} from "../src/jenkins/JenkinsRevisionEvidence";
import { assessCommit } from "../src/currentBranch/CurrentBranchCommitHistory";
import type { JenkinsBuild } from "../src/jenkins/types";

const head = "a".repeat(40);
const previous = "b".repeat(40);
const repositories = ["github.com/team/app"];
const build = (number: number, revision = head): JenkinsBuild => ({
  number,
  url: `https://ci.test/job/app/${number}/`,
  result: "SUCCESS",
  actions: [{ lastBuiltRevision: { SHA1: revision }, remoteUrls: ["git@github.com:team/app.git"] }]
});

describe("repository-aware commit evidence", () => {
  it("normalizes transports without conflating hosts, forks or case-sensitive paths", () => {
    expect(normalizeRepositoryUrl("https://user:secret@github.com/team/app.git/")).toBe(
      repositories[0]
    );
    expect(normalizeRepositoryUrl("ssh://git@github.com/team/app.git")).toBe(repositories[0]);
    expect(normalizeRepositoryUrl("git@alias:team/App.git")).toBe("alias/team/App");
    expect(normalizeRepositoryUrl("/local/repo")).toBeUndefined();
  });

  it("requires full SHA and repository evidence", () => {
    expect(assessBuildRevision(build(1), repositories).kind).toBe("verified");
    expect(assessBuildRevision(build(1, head.slice(0, 7)), repositories).kind).toBe("unverified");
    expect(assessBuildRevision(build(1), ["github.com/fork/app"]).kind).toBe("unverified");
    expect(
      assessBuildRevision(
        { ...build(1), actions: [{ lastBuiltRevision: { SHA1: head } }] },
        repositories
      ).kind
    ).toBe("unverified");
  });

  it("ignores unrelated checkouts but rejects conflicting records for this repository", () => {
    const value = build(1);
    value.actions?.push({
      lastBuiltRevision: { SHA1: previous },
      remoteUrls: ["https://github.com/team/library"]
    });
    expect(assessBuildRevision(value, repositories).kind).toBe("verified");
    value.actions?.push(...(build(2, previous).actions ?? []));
    expect(assessBuildRevision(value, repositories).kind).toBe("unverified");
  });

  it("does not infer PR source identity from an exported pullHash alone", () => {
    const value = build(1, previous);
    value.actions?.push({
      _class: "jenkins.scm.api.SCMRevisionAction",
      revision: {
        _class: "org.jenkinsci.plugins.github_branch_source.PullRequestSCMRevision",
        pullHash: head,
        head: { name: "PR-4" }
      }
    });
    const result = assessBuildRevision(value, repositories);
    expect(result.kind === "verified" && result.evidence.revision).toBe(previous);
  });

  it("uses the newest verified attempt rather than an earlier success", () => {
    const current = { ...build(3), building: true, result: undefined };
    const history = {
      job: { name: "app", url: "https://ci.test/job/app/" },
      builds: [build(1), build(4, previous), current],
      lastPass: build(1)
    };
    const assessment = assessCommit(history, { head, repositories, dirty: true });
    expect(assessment.current?.build.number).toBe(3);
    expect(assessment.current?.build.building).toBe(true);
    expect(
      assessCommit(history, { head: "c".repeat(40), repositories, dirty: false }).reason
    ).toContain("newest 50");
  });

  it("validates the base checkout for a fork merge and accepts direct HEAD checkouts", () => {
    const value = build(1, previous);
    const revision = {
      _class: "org.jenkinsci.plugins.github_branch_source.PullRequestSCMRevision",
      pullHash: head,
      mergeHash: previous,
      head: { sourceOwner: "fork", sourceRepo: "app", checkoutStrategy: "MERGE" }
    };
    value.actions?.push({ _class: "jenkins.scm.api.SCMRevisionAction", revision });
    expect(assessBuildRevision(value, ["github.com/fork/app"]).kind).toBe("verified");
    const savedMerge = revision.mergeHash;
    revision.mergeHash = "";
    expect(assessBuildRevision(value, ["github.com/fork/app"]).kind).toBe("unverified");
    revision.mergeHash = savedMerge;
    revision.mergeHash = head;
    expect(assessBuildRevision(value, ["github.com/fork/app"]).kind).toBe("unverified");
    revision.head = { sourceOwner: "team", sourceRepo: "app", checkoutStrategy: "HEAD" };
    revision.pullHash = previous;
    expect(assessBuildRevision(value, repositories).kind).toBe("verified");
  });
});

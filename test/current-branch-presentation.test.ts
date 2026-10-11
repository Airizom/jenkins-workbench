import { describe, expect, it } from "vitest";
import { assessCommit } from "../src/currentBranch/CurrentBranchCommitHistory";
import { formatCurrentBranchTooltip } from "../src/currentBranch/CurrentBranchPresentation";
import type { CurrentBranchState } from "../src/currentBranch/CurrentBranchTypes";

type Matched = Extract<CurrentBranchState, { kind: "matched" }>;

const head = "a".repeat(40);
const checkout = { head, dirty: false, repositories: ["github.com/team/app"] };

function matchedState(overrides: Partial<Matched> = {}): Matched {
  return {
    kind: "matched",
    repository: {
      repositoryUriString: "file:///app",
      repositoryLabel: "app",
      repositoryPath: "/app"
    },
    branchName: "feature",
    link: { multibranchLabel: "App" } as Matched["link"],
    environment: { environmentId: "ci", scope: "workspace", url: "https://ci.test" },
    resolvedTargetKind: "pullRequest",
    jobName: "PR-7",
    jobUrl: "https://ci.test/job/app/job/PR-7/",
    pullRequest: { number: 7, title: "Add feature" },
    ...overrides
  };
}

function expectSummaryAfterBranch(tooltip: string): void {
  const lines = tooltip.split("\n");
  const branchIndex = lines.indexOf("Branch: feature");
  expect(branchIndex).toBeGreaterThanOrEqual(0);
  expect(lines[branchIndex + 1]).toBe("PR #7: Add feature");
  expect(lines[branchIndex + 2]).toBe("Job: PR-7");
}

describe("formatCurrentBranchTooltip", () => {
  it("places the pull request summary after the branch line without commit assessment", () => {
    expectSummaryAfterBranch(formatCurrentBranchTooltip(matchedState()));
  });

  it("places the pull request summary after the branch line with commit assessment", () => {
    const history = {
      job: { name: "PR-7", url: "https://ci.test/job/app/job/PR-7/" },
      builds: []
    } as unknown as Parameters<typeof assessCommit>[0];
    const state = matchedState({ checkout, commit: assessCommit(history, checkout), history });
    expectSummaryAfterBranch(formatCurrentBranchTooltip(state));
  });
});

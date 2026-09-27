import type * as vscode from "vscode";
import type { CurrentBranchState } from "../../currentBranch/CurrentBranchTypes";

export type CurrentBranchAction =
  | "openBranch"
  | "openMultibranch"
  | "triggerBuild"
  | "openLatestBuild"
  | "openCurrentCommitBuild"
  | "watchCurrentCommit"
  | "manageCommitWatches"
  | "openLastFailed"
  | "scanMultibranch"
  | "refresh"
  | "relink"
  | "unlink";

export type CurrentBranchActionPick = vscode.QuickPickItem & {
  action: CurrentBranchAction;
};

const COMMON_ACTION_PICKS: readonly CurrentBranchActionPick[] = [
  { label: "Refresh Current Branch Status", action: "refresh" },
  { label: "Relink Repository", action: "relink" },
  { label: "Unlink Repository", action: "unlink" }
];

const BRANCH_MISSING_ACTION_PICKS: readonly CurrentBranchActionPick[] = [
  { label: "Open Linked Multibranch in Jenkins", action: "openMultibranch" },
  { label: "Scan Linked Multibranch Now", action: "scanMultibranch" },
  ...COMMON_ACTION_PICKS
];

function buildMatchedActionPicks(includeLatestBuild: boolean): readonly CurrentBranchActionPick[] {
  const picks: CurrentBranchActionPick[] = [
    { label: "Open Build for Current Commit", action: "openCurrentCommitBuild" },
    { label: "Notify When Current Commit Finishes", action: "watchCurrentCommit" },
    { label: "Manage Commit Watches", action: "manageCommitWatches" },
    { label: "Open Current Jenkins Job", action: "openBranch" },
    { label: "Trigger Current Jenkins Build", action: "triggerBuild" }
  ];
  if (includeLatestBuild) {
    picks.push({ label: "Open Latest Build Details", action: "openLatestBuild" });
  }
  picks.push({ label: "Open Last Failed Build", action: "openLastFailed" }, ...COMMON_ACTION_PICKS);
  return picks;
}

export function buildActionPicks(state: CurrentBranchState): readonly CurrentBranchActionPick[] {
  if (state.kind === "matched") {
    return buildMatchedActionPicks(Boolean(state.lastBuild?.url));
  }

  if (state.kind === "branchMissing") {
    return BRANCH_MISSING_ACTION_PICKS;
  }

  return COMMON_ACTION_PICKS;
}

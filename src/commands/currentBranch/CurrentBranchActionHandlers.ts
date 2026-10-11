import * as vscode from "vscode";
import { formatCurrentBranchTooltip } from "../../currentBranch/CurrentBranchPresentation";
import type {
  CurrentBranchRepositoryInfo,
  CurrentBranchState
} from "../../currentBranch/CurrentBranchTypes";
import type { CurrentBranchWorkflowService } from "../../currentBranch/CurrentBranchWorkflowService";
import { withActionErrorMessage } from "../CommandUtils";
import { buildActionPicks, type CurrentBranchAction } from "./CurrentBranchActionPicks";
import { linkCurrentRepository, unlinkCurrentRepository } from "./CurrentBranchLinkHandlers";
import {
  FORCE_REFRESH_OPTIONS,
  openRequest,
  resolveCurrentBranchSelection,
  unwrapResolvedState,
  withResolvedCurrentBranchState
} from "./CurrentBranchResolution";

interface CurrentBranchActionContext {
  workflowService: CurrentBranchWorkflowService;
  state: CurrentBranchState;
  selectedRepository?: CurrentBranchRepositoryInfo;
}

const CURRENT_BRANCH_ACTION_RUNNERS: Record<
  CurrentBranchAction,
  (context: CurrentBranchActionContext) => Promise<void>
> = {
  openCurrentCommitBuild: ({ workflowService, state }) =>
    workflowService.openCurrentCommitBuild(state),
  watchCurrentCommit: ({ workflowService, state }) => workflowService.watchCurrentCommit(state),
  manageCommitWatches: ({ workflowService }) => workflowService.manageCommitWatches(),
  openBranch: ({ workflowService, state }) =>
    openRequest(workflowService.getOpenBranchRequest(state)),
  openMultibranch: ({ workflowService, state }) =>
    openRequest(workflowService.getOpenMultibranchRequest(state)),
  triggerBuild: ({ workflowService, state }) => triggerBuildForLatestState(workflowService, state),
  openLatestBuild: ({ workflowService, state }) => workflowService.openLatestBuild(state),
  openLastFailed: ({ workflowService, state }) => workflowService.openLastFailedBuild(state),
  scanMultibranch: ({ workflowService, state }) => scanLinkedMultibranch(workflowService, state),
  refresh: async ({ workflowService, selectedRepository }) => {
    if (selectedRepository) {
      await refreshSelectedRepositoryStatus(workflowService, selectedRepository);
      return;
    }
    await workflowService.refreshCurrentBranchStatus(FORCE_REFRESH_OPTIONS);
  },
  relink: ({ workflowService, state, selectedRepository }) =>
    linkCurrentRepository(workflowService, selectedRepository ?? state.repository),
  unlink: ({ workflowService, state, selectedRepository }) =>
    unlinkCurrentRepository(workflowService, selectedRepository ?? state.repository)
};

export async function showCurrentBranchActions(
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  const resolved = await resolveCurrentBranchSelection(workflowService);
  if (!resolved) {
    return;
  }
  const { state, selectedRepository } = resolved;

  const pick = await vscode.window.showQuickPick(buildActionPicks(state), {
    placeHolder: "Select a Jenkins action for the current branch",
    ignoreFocusOut: true
  });
  if (!pick) {
    return;
  }

  await CURRENT_BRANCH_ACTION_RUNNERS[pick.action]({
    workflowService,
    state,
    selectedRepository
  });
}

export async function openCurrentBranchInJenkins(
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  await withResolvedCurrentBranchState(workflowService, async (state) => {
    await openRequest(workflowService.getOpenBranchRequest(state));
  });
}

export async function triggerCurrentBranchBuild(
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  await withResolvedCurrentBranchState(workflowService, async (state) => {
    await workflowService.triggerCurrentBranchBuild(state);
  });
}

async function triggerBuildForLatestState(
  workflowService: CurrentBranchWorkflowService,
  state: CurrentBranchState
): Promise<void> {
  if (!state.repository) {
    await workflowService.triggerCurrentBranchBuild(state);
    return;
  }

  const latestState = unwrapResolvedState(
    await workflowService.resolveCurrentBranchStateForRepository(
      state.repository,
      FORCE_REFRESH_OPTIONS
    )
  );
  if (!latestState) {
    return;
  }

  if (latestState.branchName !== state.branchName) {
    void vscode.window.showWarningMessage(
      `The current branch changed from ${state.branchName ?? "an unknown branch"} to ${latestState.branchName ?? "an unknown branch"}. Run Current Branch Actions again to trigger a build.`
    );
    return;
  }

  await workflowService.triggerCurrentBranchBuild(latestState);
}

/**
 * The shared status bar cannot represent a repository picked from an ambiguous
 * workspace, so report the refreshed status for that repository directly.
 */
async function refreshSelectedRepositoryStatus(
  workflowService: CurrentBranchWorkflowService,
  repository: CurrentBranchRepositoryInfo
): Promise<void> {
  const result = await workflowService.resolveCurrentBranchStateForRepository(
    repository,
    FORCE_REFRESH_OPTIONS
  );
  const state = unwrapResolvedState(result);
  if (!state) {
    return;
  }
  const reportedResolutionMessage = result.kind === "resolved" && Boolean(result.message);
  if (state.kind !== "matched" && state.kind !== "branchMissing" && reportedResolutionMessage) {
    return;
  }
  void vscode.window.showInformationMessage(formatRefreshedStatus(state, repository));
}

function formatRefreshedStatus(
  state: CurrentBranchState,
  repository: CurrentBranchRepositoryInfo
): string {
  switch (state.kind) {
    case "noGit":
    case "noRepository":
    case "ambiguousRepository":
      return `Refreshed Jenkins status for ${repository.repositoryLabel}.`;
    case "unlinked":
      return `${repository.repositoryLabel} is not linked to Jenkins.`;
    default:
      return formatCurrentBranchTooltip(state).split("\n").join(" • ");
  }
}

async function scanLinkedMultibranch(
  workflowService: CurrentBranchWorkflowService,
  state: CurrentBranchState
): Promise<void> {
  await withActionErrorMessage("Unable to scan the linked multibranch", async () => {
    const result = await workflowService.scanLinkedMultibranch(state);
    if (!result) {
      return;
    }

    void vscode.window.showInformationMessage(result.message);
  });
}

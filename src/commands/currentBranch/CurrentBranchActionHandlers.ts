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
  extensionUri: vscode.Uri;
}

const CURRENT_BRANCH_ACTION_RUNNERS: Record<
  CurrentBranchAction,
  (context: CurrentBranchActionContext) => Promise<void>
> = {
  openCurrentCommitBuild: ({ workflowService, state, extensionUri }) =>
    workflowService.openCurrentCommitBuild(state, extensionUri),
  watchCurrentCommit: ({ workflowService, state }) => workflowService.watchCurrentCommit(state),
  manageCommitWatches: ({ workflowService }) => workflowService.manageCommitWatches(),
  openBranch: ({ workflowService, state }) =>
    openRequest(workflowService.getOpenBranchRequest(state)),
  openMultibranch: ({ workflowService, state }) =>
    openRequest(workflowService.getOpenMultibranchRequest(state)),
  triggerBuild: ({ workflowService, state }) => triggerBuildForLatestState(workflowService, state),
  openLatestBuild: ({ workflowService, state, extensionUri }) =>
    workflowService.openLatestBuild(state, extensionUri),
  openLastFailed: ({ workflowService, state, extensionUri }) =>
    workflowService.openLastFailedBuild(state, extensionUri),
  scanMultibranch: ({ workflowService, state }) => scanLinkedMultibranch(workflowService, state),
  refresh: async ({ workflowService, selectedRepository }) => {
    if (selectedRepository) {
      await refreshSelectedRepositoryStatus(workflowService, selectedRepository);
      return;
    }
    await workflowService.refreshCurrentBranchStatus(FORCE_REFRESH_OPTIONS);
  },
  relink: ({ workflowService }) => linkCurrentRepository(workflowService),
  unlink: ({ workflowService }) => unlinkCurrentRepository(workflowService)
};

export async function showCurrentBranchActions(
  workflowService: CurrentBranchWorkflowService,
  extensionUri: vscode.Uri
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
    selectedRepository,
    extensionUri
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
  const state = unwrapResolvedState(
    await workflowService.resolveCurrentBranchStateForRepository(repository, FORCE_REFRESH_OPTIONS)
  );
  if (state?.kind !== "matched" && state?.kind !== "branchMissing") {
    return;
  }
  void vscode.window.showInformationMessage(
    formatCurrentBranchTooltip(state).split("\n").join(" • ")
  );
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

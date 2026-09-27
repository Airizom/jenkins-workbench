import * as vscode from "vscode";
import type {
  CurrentBranchRepositoryInfo,
  CurrentBranchState
} from "../../currentBranch/CurrentBranchTypes";
import type {
  CurrentBranchOpenRequest,
  CurrentBranchResolutionResult,
  CurrentBranchWorkflowService
} from "../../currentBranch/CurrentBranchWorkflowService";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { pickRepository } from "./CurrentBranchPrompts";

export const FORCE_REFRESH_OPTIONS = { force: true };

export interface CurrentBranchSelection {
  state: CurrentBranchState;
  selectedRepository?: CurrentBranchRepositoryInfo;
}

export async function resolveCurrentBranchState(
  workflowService: CurrentBranchWorkflowService
): Promise<CurrentBranchState | undefined> {
  return (await resolveCurrentBranchSelection(workflowService))?.state;
}

export async function resolveCurrentBranchSelection(
  workflowService: CurrentBranchWorkflowService
): Promise<CurrentBranchSelection | undefined> {
  const result = await workflowService.resolveCurrentBranchState(FORCE_REFRESH_OPTIONS);
  if (result.kind === "ambiguousRepository") {
    const repository = await pickRepository(
      workflowService,
      "Select the Git repository to inspect in Jenkins"
    );
    if (!repository) {
      return undefined;
    }
    const state = unwrapResolvedState(
      await workflowService.resolveCurrentBranchStateForRepository(
        repository,
        FORCE_REFRESH_OPTIONS
      )
    );
    return state ? { state, selectedRepository: repository } : undefined;
  }

  const state = unwrapResolvedState(result);
  return state ? { state } : undefined;
}

export async function withResolvedCurrentBranchState(
  workflowService: CurrentBranchWorkflowService,
  action: (state: CurrentBranchState) => Promise<void>
): Promise<void> {
  const state = await resolveCurrentBranchState(workflowService);
  if (!state) {
    return;
  }

  await action(state);
}

export function unwrapResolvedState(
  result: CurrentBranchResolutionResult
): CurrentBranchState | undefined {
  if (result.kind === "message") {
    showUserMessage(result);
    return undefined;
  }

  if (result.kind !== "resolved") {
    return undefined;
  }

  if (result.message) {
    showUserMessage(result.message);
  }
  return result.state;
}

export async function openRequest(request: CurrentBranchOpenRequest | undefined): Promise<void> {
  if (!request) {
    return;
  }

  if (request.kind === "message") {
    showUserMessage(request);
    return;
  }

  await openExternalHttpUrlWithWarning(request.url, {
    targetLabel: request.targetLabel
  });
}

function showUserMessage(message: { severity: "info" | "warning"; message: string }): void {
  if (message.severity === "warning") {
    void vscode.window.showWarningMessage(message.message);
    return;
  }

  void vscode.window.showInformationMessage(message.message);
}

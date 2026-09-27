import * as vscode from "vscode";
import type { CurrentBranchWorkflowService } from "../currentBranch/CurrentBranchWorkflowService";
import type { JenkinsFolderTreeItem } from "../tree/TreeItems";
import {
  openCurrentBranchInJenkins,
  showCurrentBranchActions,
  triggerCurrentBranchBuild
} from "./currentBranch/CurrentBranchActionHandlers";
import {
  linkCurrentRepository,
  linkRepositoryHere,
  unlinkCurrentRepository
} from "./currentBranch/CurrentBranchLinkHandlers";
import { resolveCurrentBranchState } from "./currentBranch/CurrentBranchResolution";

export function registerCurrentBranchCommands(
  context: vscode.ExtensionContext,
  workflowService: CurrentBranchWorkflowService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.openCurrentCommitBuild", async () => {
      const state = await resolveCurrentBranchState(workflowService);
      if (state) await workflowService.openCurrentCommitBuild(state, context.extensionUri);
    }),
    vscode.commands.registerCommand("jenkinsWorkbench.watchCurrentCommit", async () => {
      const state = await resolveCurrentBranchState(workflowService);
      if (state) await workflowService.watchCurrentCommit(state);
    }),
    vscode.commands.registerCommand("jenkinsWorkbench.manageCommitWatches", () =>
      workflowService.manageCommitWatches()
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.linkCurrentRepository", () =>
      linkCurrentRepository(workflowService)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.linkRepositoryHere",
      (item?: JenkinsFolderTreeItem) => linkRepositoryHere(item, workflowService)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.unlinkCurrentRepository", () =>
      unlinkCurrentRepository(workflowService)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.currentBranchActions", () =>
      showCurrentBranchActions(workflowService, context.extensionUri)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.openCurrentBranchInJenkins", () =>
      openCurrentBranchInJenkins(workflowService)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.triggerCurrentBranchBuild", () =>
      triggerCurrentBranchBuild(workflowService)
    )
  );
}

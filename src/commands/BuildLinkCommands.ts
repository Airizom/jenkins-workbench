import * as vscode from "vscode";
import type { CurrentBranchState } from "../currentBranch/CurrentBranchTypes";
import type { CurrentBranchWorkflowService } from "../currentBranch/CurrentBranchWorkflowService";
import type { BuildTreeItem, JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import {
  type BuildNumberContext,
  copyBuildOrJobLink,
  type OpenBuildDependencies,
  openBuild,
  openBuildByNumber
} from "./build/BuildLinkHandlers";

export interface BuildLinkCommandDependencies
  extends Omit<OpenBuildDependencies, "resolveCurrentBranchJob"> {
  currentBranchWorkflowService: CurrentBranchWorkflowService;
}

export function registerBuildLinkCommands(
  context: vscode.ExtensionContext,
  dependencies: BuildLinkCommandDependencies
): void {
  const { currentBranchWorkflowService, ...rest } = dependencies;
  const openDependencies: OpenBuildDependencies = {
    ...rest,
    resolveCurrentBranchJob: () =>
      resolveCurrentBranchJob(currentBranchWorkflowService.getCachedState())
  };
  const { currentBuild } = dependencies;
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.openBuild", () =>
      openBuild(openDependencies)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.openBuildByNumber",
      (item?: JobTreeItem | PipelineTreeItem) => openBuildByNumber(openDependencies, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.copyJenkinsLink",
      (item?: BuildTreeItem | JobTreeItem | PipelineTreeItem) =>
        copyBuildOrJobLink("jenkins", currentBuild, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.copyWorkbenchLink",
      (item?: BuildTreeItem | JobTreeItem | PipelineTreeItem) =>
        copyBuildOrJobLink("workbench", currentBuild, item)
    )
  );
}

/**
 * Uses the already-resolved current-branch job, so opening the prompt never waits on Git or Jenkins.
 * Ambiguous or unlinked repositories have no matched state and are skipped.
 */
export function resolveCurrentBranchJob(state: CurrentBranchState): BuildNumberContext | undefined {
  if (state.kind !== "matched") {
    return undefined;
  }
  return { environment: state.environment, jobUrl: state.jobUrl, source: "current branch" };
}

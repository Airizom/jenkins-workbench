import * as vscode from "vscode";
import type { CurrentBranchWorkflowService } from "../../currentBranch/CurrentBranchWorkflowService";
import { resolveTreeItemLabel } from "../../tree/TreeItemLabels";
import type { JenkinsFolderTreeItem } from "../../tree/TreeItems";
import { pickMultibranchTarget, pickRepository } from "./CurrentBranchPrompts";

export async function linkCurrentRepository(
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  const repository = await pickRepository(
    workflowService,
    "Select the Git repository to link to Jenkins"
  );
  if (!repository) {
    return;
  }

  const target = await pickMultibranchTarget(workflowService);
  if (!target) {
    return;
  }

  await workflowService.linkRepository(repository, target);
  void vscode.window.showInformationMessage(
    `Linked ${repository.repositoryLabel} to ${target.multibranchLabel}.`
  );
}

export async function linkRepositoryHere(
  item: JenkinsFolderTreeItem | undefined,
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  if (item?.folderKind !== "multibranch") {
    void vscode.window.showInformationMessage("Select a multibranch folder to link.");
    return;
  }

  const repository = await pickRepository(
    workflowService,
    "Select the Git repository to link to this multibranch"
  );
  if (!repository) {
    return;
  }

  const itemLabel = resolveTreeItemLabel(item);
  const multibranchLabel = itemLabel ?? "Multibranch";
  await workflowService.linkRepository(repository, {
    environment: item.environment,
    environmentUrl: item.environment.url,
    multibranchFolderUrl: item.folderUrl,
    multibranchLabel
  });
  void vscode.window.showInformationMessage(
    `Linked ${repository.repositoryLabel} to ${itemLabel ?? "that multibranch"}.`
  );
}

export async function unlinkCurrentRepository(
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  const repository = await pickRepository(
    workflowService,
    "Select the Git repository to unlink from Jenkins"
  );
  if (!repository) {
    return;
  }

  const removed = await workflowService.unlinkRepository(repository);
  if (!removed) {
    void vscode.window.showInformationMessage(
      `${repository.repositoryLabel} is not currently linked to Jenkins.`
    );
    return;
  }

  void vscode.window.showInformationMessage(
    `Removed the Jenkins link for ${repository.repositoryLabel}.`
  );
}

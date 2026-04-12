import * as path from "node:path";
import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileStepCatalogService } from "../../jenkinsfile/JenkinsfileStepCatalogService";
import type { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsfileEnvironmentResolver } from "../../validation/JenkinsfileEnvironmentResolver";
import type { JenkinsfileValidationCoordinator } from "../../validation/JenkinsfileValidationCoordinator";

export async function validateActiveJenkinsfile(
  coordinator: JenkinsfileValidationCoordinator
): Promise<void> {
  await coordinator.validateActiveEditor();
}

export async function selectValidationEnvironment(
  resolver: JenkinsfileEnvironmentResolver,
  store: JenkinsEnvironmentStore,
  coordinator?: JenkinsfileValidationCoordinator,
  stepCatalogService?: JenkinsfileStepCatalogService
): Promise<void> {
  const workspaceFolder = await pickWorkspaceFolder();
  if (workspaceFolder === undefined) {
    return;
  }

  const environments = await store.listEnvironmentsWithScope();
  if (environments.length === 0) {
    void vscode.window.showInformationMessage("No Jenkins environments are configured.");
    return;
  }

  const picks = environments.map((environment) => ({
    label: environment.url,
    description: formatScopeLabel(environment.scope),
    detail: environment.id,
    environment
  }));
  const workspaceLabel = workspaceFolder?.name ?? "this window";
  const clearPick = {
    label: "Clear selection",
    description: "Prompt again the next time Jenkinsfile features need an environment",
    detail: workspaceLabel,
    environment: undefined
  };
  const pick = await vscode.window.showQuickPick([...picks, clearPick], {
    placeHolder: workspaceFolder
      ? `Select a Jenkins environment for ${workspaceFolder.name} Jenkinsfile features`
      : "Select a Jenkins environment for Jenkinsfile features",
    matchOnDescription: true,
    ignoreFocusOut: true
  });

  if (!pick) {
    return;
  }

  const selected = pick.environment;
  if (!selected) {
    await resolver.setWorkspaceFolderOverride(workspaceFolder ?? undefined, undefined);
    void vscode.window.showInformationMessage(
      `Cleared Jenkinsfile environment for ${workspaceLabel}.`
    );
    if (workspaceFolder) {
      coordinator?.clearWorkspaceState(workspaceFolder);
    } else {
      coordinator?.clearFallbackState();
    }
    return;
  }

  const ref: JenkinsEnvironmentRef = {
    environmentId: selected.id,
    scope: selected.scope,
    url: selected.url,
    username: selected.username
  };
  await resolver.setWorkspaceFolderOverride(workspaceFolder ?? undefined, ref);
  stepCatalogService?.invalidateEnvironment(ref);
  void vscode.window.showInformationMessage(
    `Jenkinsfile features will use ${selected.url} (${formatScopeLabel(selected.scope)}).`
  );
  if (workspaceFolder) {
    coordinator?.revalidateWorkspaceState(workspaceFolder);
  } else {
    coordinator?.revalidateFallbackState();
  }
}

export function clearJenkinsfileDiagnostics(coordinator: JenkinsfileValidationCoordinator): void {
  coordinator.clearDiagnostics();
}

export function showJenkinsfileValidationOutput(
  coordinator: JenkinsfileValidationCoordinator
): void {
  coordinator.showOutputChannel();
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | null | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return null;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  const picks = folders.map((folder) => ({
    label: folder.name,
    description: path.basename(folder.uri.fsPath),
    folder
  }));
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: "Select the workspace folder for Jenkinsfile validation",
    matchOnDescription: true,
    ignoreFocusOut: true
  });
  return pick?.folder;
}

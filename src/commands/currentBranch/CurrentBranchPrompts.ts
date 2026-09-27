import * as vscode from "vscode";
import type { CurrentBranchRepositoryInfo } from "../../currentBranch/CurrentBranchTypes";
import type {
  CurrentBranchLinkableEnvironment,
  CurrentBranchMultibranchTarget,
  CurrentBranchWorkflowService
} from "../../currentBranch/CurrentBranchWorkflowService";

export async function pickRepository(
  workflowService: CurrentBranchWorkflowService,
  placeHolder: string
): Promise<CurrentBranchRepositoryInfo | undefined> {
  const repositories = workflowService.listRepositories();
  if (!repositories) {
    void vscode.window.showInformationMessage("Git integration is unavailable.");
    return undefined;
  }

  if (repositories.length === 0) {
    void vscode.window.showInformationMessage("No Git repositories are open in this workspace.");
    return undefined;
  }

  if (repositories.length === 1) {
    return repositories[0];
  }

  const pick = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: repository.repositoryLabel,
      description: repository.repositoryPath,
      repository
    })),
    {
      placeHolder,
      matchOnDescription: true,
      ignoreFocusOut: true
    }
  );
  return pick?.repository;
}

export async function pickMultibranchTarget(
  workflowService: CurrentBranchWorkflowService
): Promise<CurrentBranchMultibranchTarget | undefined> {
  const environments = await workflowService.listLinkableEnvironments();
  if (environments.kind === "noEnvironments") {
    void vscode.window.showInformationMessage("No Jenkins environments are configured.");
    return undefined;
  }

  const selectedEnvironment = await pickLinkableEnvironment(environments.environments);
  if (!selectedEnvironment) {
    return undefined;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Loading Jenkins multibranch pipelines from ${selectedEnvironment.environment.scope}/${selectedEnvironment.environment.environmentId}`,
      cancellable: false
    },
    () => workflowService.discoverMultibranchTargets(selectedEnvironment.environment)
  );

  if (result.kind === "failed") {
    void vscode.window.showWarningMessage(
      `Unable to load multibranch pipelines for ${result.environment.scope}/${result.environment.environmentId}: ${result.message}`
    );
    return undefined;
  }

  if (result.targets.length === 0) {
    void vscode.window.showInformationMessage("No multibranch pipelines were found.");
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    result.targets.map((target) => ({
      label: target.multibranchLabel,
      description: target.environmentUrl,
      detail: `${target.environment.scope} • ${target.environment.environmentId}`,
      target
    })),
    {
      placeHolder: "Select a Jenkins multibranch pipeline",
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true
    }
  );
  return pick?.target;
}

async function pickLinkableEnvironment(
  environments: CurrentBranchLinkableEnvironment[]
): Promise<CurrentBranchLinkableEnvironment | undefined> {
  if (environments.length === 1) {
    return environments[0];
  }

  const pick = await vscode.window.showQuickPick(
    environments.map((entry) => ({
      label: `${entry.environment.scope} • ${entry.environment.environmentId}`,
      description: entry.environmentUrl,
      environment: entry
    })),
    {
      placeHolder: "Select a Jenkins environment",
      matchOnDescription: true,
      ignoreFocusOut: true
    }
  );
  return pick?.environment;
}

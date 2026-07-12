import * as vscode from "vscode";
import type { CurrentBranchState } from "../currentBranch/CurrentBranchTypes";
import type {
  CurrentBranchLinkableEnvironment,
  CurrentBranchMultibranchTarget,
  CurrentBranchOpenRequest,
  CurrentBranchResolutionResult,
  CurrentBranchWorkflowService
} from "../currentBranch/CurrentBranchWorkflowService";
import type { JenkinsFolderTreeItem } from "../tree/TreeItems";
import { openExternalHttpUrlWithWarning } from "../ui/OpenExternalUrl";
import { withActionErrorMessage } from "./CommandUtils";

type CurrentBranchAction =
  | "openBranch"
  | "openMultibranch"
  | "triggerBuild"
  | "openLatestBuild"
  | "openLastFailed"
  | "scanMultibranch"
  | "refresh"
  | "relink"
  | "unlink";

type CurrentBranchActionPick = vscode.QuickPickItem & {
  action: CurrentBranchAction;
};

const FORCE_REFRESH_OPTIONS = { force: true };

const COMMON_ACTION_PICKS: readonly CurrentBranchActionPick[] = [
  { label: "Refresh Current Branch Status", action: "refresh" },
  { label: "Relink Repository", action: "relink" },
  { label: "Unlink Repository", action: "unlink" }
];

const MATCHED_ACTION_PICKS: readonly CurrentBranchActionPick[] = [
  { label: "Open Current Jenkins Job", action: "openBranch" },
  { label: "Trigger Current Jenkins Build", action: "triggerBuild" },
  { label: "Open Last Failed Build", action: "openLastFailed" },
  ...COMMON_ACTION_PICKS
];

const MATCHED_WITH_LATEST_BUILD_ACTION_PICKS: readonly CurrentBranchActionPick[] = [
  { label: "Open Current Jenkins Job", action: "openBranch" },
  { label: "Trigger Current Jenkins Build", action: "triggerBuild" },
  { label: "Open Latest Build Details", action: "openLatestBuild" },
  { label: "Open Last Failed Build", action: "openLastFailed" },
  ...COMMON_ACTION_PICKS
];

const BRANCH_MISSING_ACTION_PICKS: readonly CurrentBranchActionPick[] = [
  { label: "Open Linked Multibranch in Jenkins", action: "openMultibranch" },
  { label: "Scan Linked Multibranch Now", action: "scanMultibranch" },
  ...COMMON_ACTION_PICKS
];

interface CurrentBranchActionContext {
  workflowService: CurrentBranchWorkflowService;
  state: CurrentBranchState;
  extensionUri: vscode.Uri;
}

const CURRENT_BRANCH_ACTION_RUNNERS: Record<
  CurrentBranchAction,
  (context: CurrentBranchActionContext) => Promise<void>
> = {
  openBranch: ({ workflowService, state }) =>
    openRequest(workflowService.getOpenBranchRequest(state)),
  openMultibranch: ({ workflowService, state }) =>
    openRequest(workflowService.getOpenMultibranchRequest(state)),
  triggerBuild: ({ workflowService, state }) => workflowService.triggerCurrentBranchBuild(state),
  openLatestBuild: ({ workflowService, state, extensionUri }) =>
    workflowService.openLatestBuild(state, extensionUri),
  openLastFailed: ({ workflowService, state, extensionUri }) =>
    workflowService.openLastFailedBuild(state, extensionUri),
  scanMultibranch: ({ workflowService, state }) => scanLinkedMultibranch(workflowService, state),
  refresh: async ({ workflowService }) => {
    await workflowService.refreshCurrentBranchStatus(FORCE_REFRESH_OPTIONS);
  },
  relink: ({ workflowService }) => linkCurrentRepository(workflowService),
  unlink: ({ workflowService }) => unlinkCurrentRepository(workflowService)
};

export function registerCurrentBranchCommands(
  context: vscode.ExtensionContext,
  workflowService: CurrentBranchWorkflowService
): void {
  context.subscriptions.push(
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

async function linkCurrentRepository(workflowService: CurrentBranchWorkflowService): Promise<void> {
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

async function linkRepositoryHere(
  item: JenkinsFolderTreeItem | undefined,
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  if (!item || item.folderKind !== "multibranch") {
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

  const itemLabel = getItemLabel(item);
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

async function unlinkCurrentRepository(
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

async function pickRepository(workflowService: CurrentBranchWorkflowService, placeHolder: string) {
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

async function showCurrentBranchActions(
  workflowService: CurrentBranchWorkflowService,
  extensionUri: vscode.Uri
): Promise<void> {
  const state = await resolveCurrentBranchState(workflowService);
  if (!state) {
    return;
  }

  const pick = await vscode.window.showQuickPick(buildActionPicks(state), {
    placeHolder: "Select a Jenkins action for the current branch",
    ignoreFocusOut: true
  });
  if (!pick) {
    return;
  }

  await CURRENT_BRANCH_ACTION_RUNNERS[pick.action]({ workflowService, state, extensionUri });
}

async function openCurrentBranchInJenkins(
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  await withResolvedCurrentBranchState(workflowService, async (state) => {
    await openRequest(workflowService.getOpenBranchRequest(state));
  });
}

async function triggerCurrentBranchBuild(
  workflowService: CurrentBranchWorkflowService
): Promise<void> {
  await withResolvedCurrentBranchState(workflowService, async (state) => {
    await workflowService.triggerCurrentBranchBuild(state);
  });
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

async function pickMultibranchTarget(
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

async function resolveCurrentBranchState(
  workflowService: CurrentBranchWorkflowService
): Promise<CurrentBranchState | undefined> {
  const result = await workflowService.resolveCurrentBranchState(FORCE_REFRESH_OPTIONS);
  if (result.kind === "ambiguousRepository") {
    const repository = await pickRepository(
      workflowService,
      "Select the Git repository to inspect in Jenkins"
    );
    if (!repository) {
      return undefined;
    }
    return unwrapResolvedState(
      await workflowService.resolveCurrentBranchStateForRepository(
        repository,
        FORCE_REFRESH_OPTIONS
      )
    );
  }

  return unwrapResolvedState(result);
}

async function withResolvedCurrentBranchState(
  workflowService: CurrentBranchWorkflowService,
  action: (state: CurrentBranchState) => Promise<void>
): Promise<void> {
  const state = await resolveCurrentBranchState(workflowService);
  if (!state) {
    return;
  }

  await action(state);
}

function unwrapResolvedState(
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

function showUserMessage(message: { severity: "info" | "warning"; message: string }): void {
  if (message.severity === "warning") {
    void vscode.window.showWarningMessage(message.message);
    return;
  }

  void vscode.window.showInformationMessage(message.message);
}

async function openRequest(request: CurrentBranchOpenRequest | undefined): Promise<void> {
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

function buildActionPicks(state: CurrentBranchState): readonly CurrentBranchActionPick[] {
  if (state.kind === "matched") {
    return state.lastBuild?.url ? MATCHED_WITH_LATEST_BUILD_ACTION_PICKS : MATCHED_ACTION_PICKS;
  }

  if (state.kind === "branchMissing") {
    return BRANCH_MISSING_ACTION_PICKS;
  }

  return COMMON_ACTION_PICKS;
}

function getItemLabel(item: JenkinsFolderTreeItem): string | undefined {
  return typeof item.label === "string" ? item.label : item.label?.label;
}

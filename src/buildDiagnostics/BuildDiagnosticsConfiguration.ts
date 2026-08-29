import * as vscode from "vscode";
import type { CurrentBranchJenkinsService } from "../currentBranch/CurrentBranchJenkinsService";
import type { CurrentBranchRepositoryInfo } from "../currentBranch/CurrentBranchTypes";
import { getBuildDiagnosticsConfig } from "../extension/ExtensionConfig";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsDiagnosticProfileBindingStore } from "../storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsRepositoryLinkStore } from "../storage/JenkinsRepositoryLinkStore";
import { toParentJobUrl } from "./BuildDiagnosticContextResolver";
import { normalizeDiagnosticProfiles } from "./BuildDiagnosticProfiles";

export interface DiagnosticConfigurationTarget {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
}

type DiagnosticProfileChoiceAction = "automatic" | "profile" | "disabled" | "remove" | "settings";

interface DiagnosticProfileChoice {
  label: string;
  description?: string;
  action: DiagnosticProfileChoiceAction;
  profileId?: string;
}

export class BuildDiagnosticsConfiguration {
  constructor(
    private readonly currentBranchService: CurrentBranchJenkinsService,
    private readonly bindingStore: JenkinsDiagnosticProfileBindingStore,
    private readonly repositoryLinkStore: JenkinsRepositoryLinkStore,
    private readonly log: (message: string) => void
  ) {}

  async configure(target: DiagnosticConfigurationTarget | undefined): Promise<void> {
    if (!target) {
      void vscode.window.showInformationMessage(
        "Open Build Details, select a job, or link the current branch before configuring diagnostics."
      );
      return;
    }
    const repositories = this.currentBranchService.listRepositories() ?? [];
    if (repositories.length === 0) {
      void vscode.window.showInformationMessage(
        "Open the local Git repository before configuring build diagnostics."
      );
      return;
    }
    const jobScopeUrl = this.resolveConfigurationScope(target.environment, target.jobUrl);
    const repository = await this.selectRepository(target.environment, jobScopeUrl, repositories);
    if (!repository) {
      return;
    }
    const existing = this.bindingStore.getBinding(
      target.environment.scope,
      target.environment.environmentId,
      jobScopeUrl,
      repository.repositoryUriString
    );
    const normalized = normalizeDiagnosticProfiles(getBuildDiagnosticsConfig().profiles);
    for (const issue of normalized.issues) {
      this.log(`Profile ${issue.severity}: ${issue.path}: ${issue.message}`);
    }
    const choice = await vscode.window.showQuickPick(
      createDiagnosticProfileChoices(normalized, Boolean(existing)),
      { placeHolder: "Choose a diagnostic profile" }
    );
    if (!choice) {
      return;
    }
    await this.applyChoice(choice, target.environment, jobScopeUrl, repository.repositoryUriString);
  }

  private async selectRepository(
    environment: JenkinsEnvironmentRef,
    jobScopeUrl: string,
    repositories: readonly CurrentBranchRepositoryInfo[]
  ): Promise<CurrentBranchRepositoryInfo | undefined> {
    const configuredRepositoryUris = new Set(
      this.bindingStore
        .findBindingsForJob(environment.scope, environment.environmentId, jobScopeUrl)
        .map((binding) => binding.repositoryUri)
    );
    const configured = repositories.filter((entry) =>
      configuredRepositoryUris.has(entry.repositoryUriString)
    );
    if (configured.length === 1) {
      return configured[0];
    }
    if (repositories.length === 1) {
      return repositories[0];
    }
    const selection = await vscode.window.showQuickPick(
      repositories.map((entry) => ({
        label: entry.repositoryLabel,
        description: entry.repositoryPath,
        repository: entry
      })),
      { placeHolder: "Select the local repository for Jenkins diagnostics" }
    );
    return selection?.repository;
  }

  private async applyChoice(
    choice: DiagnosticProfileChoice,
    environment: JenkinsEnvironmentRef,
    jobScopeUrl: string,
    repositoryUri: string
  ): Promise<void> {
    if (choice.action === "settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettingsJson",
        "jenkinsWorkbench.diagnostics.profiles"
      );
      return;
    }
    if (choice.action === "remove") {
      await this.bindingStore.removeBinding(
        environment.scope,
        environment.environmentId,
        jobScopeUrl,
        repositoryUri
      );
      return;
    }
    await this.bindingStore.setBinding(environment.scope, {
      environmentId: environment.environmentId,
      jobScopeUrl,
      repositoryUri,
      profileId: choice.action === "profile" ? choice.profileId : undefined,
      enabled: choice.action !== "disabled"
    });
    void vscode.window.showInformationMessage("Jenkins build diagnostics configuration saved.");
  }

  private resolveConfigurationScope(environment: JenkinsEnvironmentRef, jobUrl: string): string {
    const parent = toParentJobUrl(jobUrl);
    if (!parent) {
      return jobUrl;
    }
    const links = this.repositoryLinkStore.findLinksForMultibranch(
      { environmentId: environment.environmentId, scope: environment.scope },
      parent
    );
    const parentBindings = this.bindingStore.findBindingsForJob(
      environment.scope,
      environment.environmentId,
      parent
    );
    return links.length > 0 || parentBindings.length > 0 ? parent : jobUrl;
  }
}

function createDiagnosticProfileChoices(
  normalized: ReturnType<typeof normalizeDiagnosticProfiles>,
  hasExistingBinding: boolean
): DiagnosticProfileChoice[] {
  const choices: DiagnosticProfileChoice[] = [
    {
      label: "Automatic broad-core",
      description: "Use all built-in compiler, linter, and stack-trace parsers",
      action: "automatic"
    },
    ...[...normalized.profiles.values()]
      .filter((profile) => profile.valid)
      .map((profile) => ({
        label: profile.id,
        description: profile.description,
        action: "profile" as const,
        profileId: profile.id
      })),
    {
      label: "Disabled",
      description: "Do not scan this Jenkins job",
      action: "disabled"
    }
  ];
  if (hasExistingBinding) {
    choices.push({ label: "Remove existing binding", action: "remove" });
  }
  choices.push({
    label: "Edit diagnostic profiles in JSON settings",
    action: "settings"
  });
  return choices;
}

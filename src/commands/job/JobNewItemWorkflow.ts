import * as vscode from "vscode";
import { formatActionError } from "../../formatters/ErrorFormatters";
import { type GitApi, getGitApi } from "../../git/GitExtensionApi";
import { listWorkspaceRemotes } from "../../git/WorkspaceRemotes";
import { JenkinsActionError, JobManagementActionError } from "../../jenkins/errors";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsItemCreateKind, JenkinsMultibranchCreateOptions } from "../../jenkins/types";
import { formatJobUrlLabel } from "../../jenkins/urls";
import type { JenkinsRepositoryLinkStore } from "../../storage/JenkinsRepositoryLinkStore";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { confirmModalAction, withActionErrorMessage } from "../CommandUtils";
import { getJobNameValidationError } from "./JobNameValidation";

interface NewItemKindDefinition {
  itemType: JenkinsItemCreateKind;
  label: string;
  description: string;
  promptLabel: string;
  defaultName: string;
  /** Plugins Jenkins needs for this item type; named in the error when creation is rejected. */
  requiredPlugins?: readonly string[];
}

const NEW_ITEM_KIND_DEFINITIONS = [
  {
    itemType: "job",
    label: "Job",
    description: "Freestyle job",
    promptLabel: "job",
    defaultName: "new-job"
  },
  {
    itemType: "pipeline",
    label: "Pipeline",
    description: "Pipeline job",
    promptLabel: "pipeline",
    defaultName: "new-pipeline"
  },
  {
    itemType: "folder",
    label: "Folder",
    description: "Folder to organize items",
    promptLabel: "folder",
    defaultName: "new-folder",
    requiredPlugins: ["cloudbees-folder"]
  },
  {
    itemType: "multibranch",
    label: "Multibranch Pipeline",
    description: "Pipeline per Git branch",
    promptLabel: "multibranch pipeline",
    defaultName: "new-multibranch",
    requiredPlugins: ["workflow-multibranch", "git"]
  }
] as const satisfies readonly NewItemKindDefinition[];

const DEFAULT_SCRIPT_PATH = "Jenkinsfile";
const LINK_REPOSITORY_ACTION = "Link Repository";
const OPEN_IN_JENKINS_ACTION = "Open in Jenkins";
/** Status codes Jenkins uses when it doesn't know the item type or the XML's classes. */
const MISSING_PLUGIN_STATUS_CODES = new Set([400, 500]);

export interface JobNewItemTarget {
  environment: JenkinsEnvironmentRef;
  parentUrl: string;
  locationLabel: string;
}

export interface JobNewItemWorkflowDependencies {
  dataService: JenkinsDataService;
  repositoryLinkStore: Pick<JenkinsRepositoryLinkStore, "getLink" | "setLink">;
  onEnvironmentChanged(environmentId: string): void;
  getGitApi?: () => Promise<GitApi | undefined>;
}

interface MultibranchSource {
  options: JenkinsMultibranchCreateOptions;
  /** Set when the URL came from a workspace remote, so the repository can be linked. */
  repositoryRootUri?: vscode.Uri;
}

interface RemotePick extends vscode.QuickPickItem {
  repositoryUrl?: string;
  repositoryRootUri?: vscode.Uri;
}

export class JobNewItemWorkflow {
  constructor(private readonly deps: JobNewItemWorkflowDependencies) {}

  async run(target: JobNewItemTarget): Promise<void> {
    const kindDefinition = await promptNewItemKind();
    if (!kindDefinition) {
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: `Enter a name for the new ${kindDefinition.promptLabel}`,
      value: kindDefinition.defaultName,
      validateInput: (value) => getJobNameValidationError(value),
      ignoreFocusOut: true
    });
    if (!newName) {
      return;
    }

    if (kindDefinition.itemType === "multibranch") {
      const source = await this.promptMultibranchSource();
      if (!source) {
        return;
      }
      await this.createMultibranch(target, kindDefinition, newName, source);
      return;
    }

    const confirmed = await confirmModalAction(
      `Create ${kindDefinition.promptLabel} "${newName}" in ${target.locationLabel}?`,
      "Create"
    );
    if (!confirmed) {
      return;
    }

    const itemType = kindDefinition.itemType;
    await withActionErrorMessage(
      `Failed to create ${kindDefinition.promptLabel} "${newName}"`,
      async () => {
        const { newUrl } = await withMissingPluginHint(kindDefinition, () =>
          this.deps.dataService.createItem(itemType, target.environment, target.parentUrl, newName)
        );
        const urlLabel = itemType === "folder" ? "New item URL" : "New job URL";
        void vscode.window.showInformationMessage(
          `Created ${kindDefinition.promptLabel} "${newName}".${newUrl ? ` ${urlLabel}: ${newUrl}` : ""}`
        );
        this.deps.onEnvironmentChanged(target.environment.environmentId);
      }
    );
  }

  private async createMultibranch(
    target: JobNewItemTarget,
    kindDefinition: NewItemKindDefinition,
    newName: string,
    source: MultibranchSource
  ): Promise<void> {
    const confirmed = await confirmModalAction(
      `Create ${kindDefinition.promptLabel} "${newName}" from ${source.options.repositoryUrl} in ${target.locationLabel}?`,
      "Create"
    );
    if (!confirmed) {
      return;
    }

    let newUrl: string | undefined;
    const created = await withActionErrorMessage(
      `Failed to create ${kindDefinition.promptLabel} "${newName}"`,
      async () => {
        ({ newUrl } = await withMissingPluginHint(kindDefinition, () =>
          this.deps.dataService.createMultibranchPipeline(
            target.environment,
            target.parentUrl,
            newName,
            source.options
          )
        ));
      }
    );
    if (!created || !newUrl) {
      return;
    }
    const itemUrl = newUrl;

    let scanSummary = "Branch scan started.";
    try {
      await this.deps.dataService.scanMultibranch(target.environment, itemUrl);
    } catch (error) {
      scanSummary = "Run Scan Multibranch Now to discover branches.";
      void vscode.window.showWarningMessage(
        `Created ${kindDefinition.promptLabel} "${newName}", but the branch scan failed to start: ${formatActionError(error)}`
      );
    }
    this.deps.onEnvironmentChanged(target.environment.environmentId);

    void this.showCreatedMessage(kindDefinition, newName, itemUrl, scanSummary);

    if (source.repositoryRootUri) {
      await this.offerRepositoryLink(target, newName, itemUrl, source.repositoryRootUri);
    }
  }

  private async showCreatedMessage(
    kindDefinition: NewItemKindDefinition,
    newName: string,
    itemUrl: string,
    scanSummary: string
  ): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `Created ${kindDefinition.promptLabel} "${newName}". ${scanSummary}`,
      OPEN_IN_JENKINS_ACTION
    );
    if (choice === OPEN_IN_JENKINS_ACTION) {
      await openExternalHttpUrlWithWarning(itemUrl, { targetLabel: "multibranch pipeline URL" });
    }
  }

  private async offerRepositoryLink(
    target: JobNewItemTarget,
    newName: string,
    itemUrl: string,
    repositoryRootUri: vscode.Uri
  ): Promise<void> {
    const existing = this.deps.repositoryLinkStore.getLink(repositoryRootUri);
    const replaceNote = existing
      ? ` This replaces its link to "${existing.multibranchLabel}".`
      : "";
    const choice = await vscode.window.showInformationMessage(
      `Link this workspace repository to "${newName}" for current-branch status?${replaceNote}`,
      LINK_REPOSITORY_ACTION
    );
    if (choice !== LINK_REPOSITORY_ACTION) {
      return;
    }

    await withActionErrorMessage(`Failed to link the repository to "${newName}"`, async () => {
      await this.deps.repositoryLinkStore.setLink(repositoryRootUri, {
        environment: {
          environmentId: target.environment.environmentId,
          scope: target.environment.scope
        },
        multibranchFolderUrl: itemUrl,
        multibranchLabel: formatJobUrlLabel(itemUrl, target.environment.url)
      });
      void vscode.window.showInformationMessage(`Linked the repository to "${newName}".`);
    });
  }

  private async promptMultibranchSource(): Promise<MultibranchSource | undefined> {
    const repository = await this.promptRepository();
    if (!repository?.repositoryUrl) {
      return undefined;
    }

    const credentialsId = await vscode.window.showInputBox({
      prompt: "Jenkins credentials ID for the repository (leave blank for a public repository)",
      placeHolder: "Optional credentials ID",
      ignoreFocusOut: true
    });
    if (credentialsId === undefined) {
      return undefined;
    }

    const scriptPath = await vscode.window.showInputBox({
      prompt: "Path to the Jenkinsfile in each branch",
      value: DEFAULT_SCRIPT_PATH,
      validateInput: (value) => (value.trim() ? undefined : "Enter a script path."),
      ignoreFocusOut: true
    });
    if (scriptPath === undefined) {
      return undefined;
    }

    return {
      options: {
        repositoryUrl: repository.repositoryUrl,
        credentialsId: credentialsId.trim() || undefined,
        scriptPath: scriptPath.trim()
      },
      repositoryRootUri: repository.repositoryRootUri
    };
  }

  private async promptRepository(): Promise<RemotePick | undefined> {
    const remotePicks = await this.listWorkspaceRemotes();
    if (remotePicks.length > 0) {
      const enterUrlPick: RemotePick = {
        label: "$(edit) Enter URL…",
        description: "Use a repository that isn't a workspace remote"
      };
      const selected = await vscode.window.showQuickPick<RemotePick>(
        [...remotePicks, enterUrlPick],
        {
          placeHolder: "Select the Git repository for the multibranch pipeline",
          matchOnDetail: true,
          ignoreFocusOut: true
        }
      );
      if (!selected || selected.repositoryUrl) {
        return selected;
      }
    }

    const repositoryUrl = await vscode.window.showInputBox({
      prompt: "Git repository URL for the multibranch pipeline",
      placeHolder: "https://github.com/org/repo.git",
      validateInput: (value) => (value.trim() ? undefined : "Enter a Git repository URL."),
      ignoreFocusOut: true
    });
    const trimmed = repositoryUrl?.trim();
    return trimmed ? { label: trimmed, repositoryUrl: trimmed } : undefined;
  }

  private async listWorkspaceRemotes(): Promise<RemotePick[]> {
    try {
      const api = await (this.deps.getGitApi ?? getGitApi)();
      return listWorkspaceRemotes(api?.repositories ?? []).map((remote) => ({
        label: formatRemoteLabel(remote.name, remote.repositoryRootUri),
        detail: remote.url,
        repositoryUrl: remote.url,
        repositoryRootUri: remote.repositoryRootUri
      }));
    } catch {
      return [];
    }
  }
}

function formatRemoteLabel(remoteName: string, rootUri: vscode.Uri): string {
  const folderName = rootUri.path.split("/").filter(Boolean).at(-1);
  return folderName ? `${remoteName} (${folderName})` : remoteName;
}

async function promptNewItemKind(): Promise<NewItemKindDefinition | undefined> {
  return vscode.window.showQuickPick(NEW_ITEM_KIND_DEFINITIONS, {
    placeHolder: "Select an item type to create",
    ignoreFocusOut: true
  });
}

/**
 * Jenkins rejects an unknown item type (missing plugin) with 400 or 500, so the error names
 * the plugins the item type needs. A taken name is reported separately as `duplicate_item`,
 * and Job and Pipeline errors pass through unchanged.
 */
async function withMissingPluginHint<T>(
  kindDefinition: NewItemKindDefinition,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const plugins = kindDefinition.requiredPlugins;
    if (!plugins?.length || !isLikelyMissingPluginError(error)) {
      throw error;
    }
    const pluginList = plugins.join(" and ");
    const noun = plugins.length === 1 ? "plugin is" : "plugins are";
    throw new JobManagementActionError(
      `${error.message} Make sure the ${pluginList} ${noun} installed on Jenkins.`,
      error.code,
      error.statusCode
    );
  }
}

function isLikelyMissingPluginError(error: unknown): error is JenkinsActionError {
  return (
    error instanceof JenkinsActionError &&
    error.code !== "duplicate_item" &&
    error.statusCode !== undefined &&
    MISSING_PLUGIN_STATUS_CODES.has(error.statusCode)
  );
}

import * as vscode from "vscode";
import { formatScopeLabel } from "../formatters/ScopeFormatters";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentScope,
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../storage/JenkinsEnvironmentStore";

interface StoredSelection {
  environmentId: string;
  scope: EnvironmentScope;
}

interface StoredSelections {
  selections?: Record<string, StoredSelection>;
}

const STATE_KEY = "jenkinsWorkbench.jenkinsfileValidation.environmentSelections";
const FALLBACK_WORKSPACE_KEY = "__noWorkspace__";

export class JenkinsfileEnvironmentResolver {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly environmentStore: JenkinsEnvironmentStore
  ) {}

  async resolveForDocument(
    document: vscode.TextDocument
  ): Promise<JenkinsEnvironmentRef | undefined> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceKey = workspaceFolder?.uri.toString() ?? FALLBACK_WORKSPACE_KEY;
    const stored = this.getStoredSelection(workspaceKey);

    if (stored) {
      const resolved = findEnvironment(environments, stored);
      if (resolved) {
        return resolved;
      }
      await this.clearStoredSelection(workspaceKey);
    }

    if (environments.length === 1) {
      const resolved = toEnvironmentRef(environments[0]);
      await this.setStoredSelection(workspaceKey, resolved);
      return resolved;
    }

    const pick = await this.promptForEnvironment(environments, workspaceFolder);
    if (!pick) {
      return undefined;
    }
    await this.setStoredSelection(workspaceKey, pick);
    return pick;
  }

  async setWorkspaceFolderOverride(
    folder: vscode.WorkspaceFolder | undefined,
    environment: JenkinsEnvironmentRef | undefined
  ): Promise<void> {
    const key = folder?.uri.toString() ?? FALLBACK_WORKSPACE_KEY;
    if (!environment) {
      await this.clearStoredSelection(key);
      return;
    }
    await this.setStoredSelection(key, environment);
  }

  private getStoredSelection(workspaceKey: string): StoredSelection | undefined {
    const state = this.context.workspaceState.get<StoredSelections>(STATE_KEY);
    return state?.selections?.[workspaceKey];
  }

  private async setStoredSelection(
    workspaceKey: string,
    environment: JenkinsEnvironmentRef
  ): Promise<void> {
    const state = this.context.workspaceState.get<StoredSelections>(STATE_KEY) ?? {};
    const selections = { ...(state.selections ?? {}) };
    selections[workspaceKey] = {
      environmentId: environment.environmentId,
      scope: environment.scope
    };
    await this.context.workspaceState.update(STATE_KEY, { ...state, selections });
  }

  private async clearStoredSelection(workspaceKey: string): Promise<void> {
    const state = this.context.workspaceState.get<StoredSelections>(STATE_KEY);
    if (!state?.selections || !(workspaceKey in state.selections)) {
      return;
    }
    const selections = { ...state.selections };
    delete selections[workspaceKey];
    await this.context.workspaceState.update(STATE_KEY, { ...state, selections });
  }

  private async promptForEnvironment(
    environments: EnvironmentWithScope[],
    workspaceFolder?: vscode.WorkspaceFolder
  ): Promise<JenkinsEnvironmentRef | undefined> {
    const picks = environments.map((environment) => ({
      label: environment.url,
      description: formatScopeLabel(environment.scope),
      detail: environment.id,
      environment
    }));
    const pick = await vscode.window.showQuickPick(picks, {
      placeHolder: workspaceFolder
        ? `Select a Jenkins environment for ${workspaceFolder.name} Jenkinsfile validation`
        : "Select a Jenkins environment for Jenkinsfile validation",
      matchOnDescription: true,
      ignoreFocusOut: true
    });
    return pick ? toEnvironmentRef(pick.environment) : undefined;
  }
}

function toEnvironmentRef(environment: EnvironmentWithScope): JenkinsEnvironmentRef {
  return {
    environmentId: environment.id,
    scope: environment.scope,
    url: environment.url,
    username: environment.username
  };
}

function findEnvironment(
  environments: EnvironmentWithScope[],
  selection: StoredSelection
): JenkinsEnvironmentRef | undefined {
  const environment = environments.find(
    (entry) => entry.id === selection.environmentId && entry.scope === selection.scope
  );
  return environment ? toEnvironmentRef(environment) : undefined;
}

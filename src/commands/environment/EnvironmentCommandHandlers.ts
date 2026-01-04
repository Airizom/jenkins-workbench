import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentScope,
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { EnvironmentCommandRefreshHost } from "./EnvironmentCommandTypes";
import { promptOptionalInput, promptRequiredInput, promptScope } from "./EnvironmentPrompts";

function normalizeJenkinsUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.endsWith("/")) {
    normalized = `${normalized}/`;
  }
  return normalized;
}

function isValidJenkinsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function addEnvironment(
  store: JenkinsEnvironmentStore,
  refreshHost: EnvironmentCommandRefreshHost
): Promise<void> {
  const scope = await promptScope();
  if (!scope) {
    return;
  }

  const rawUrl = await promptRequiredInput("Jenkins URL", "https://jenkins.example.com");
  if (!rawUrl) {
    return;
  }

  if (!isValidJenkinsUrl(rawUrl)) {
    void vscode.window.showErrorMessage(
      "Invalid Jenkins URL. Please enter a valid HTTP or HTTPS URL."
    );
    return;
  }

  const url = normalizeJenkinsUrl(rawUrl);

  const existingEnvironments = await store.getEnvironments(scope);
  const duplicate = existingEnvironments.find(
    (environment) => normalizeJenkinsUrl(environment.url) === url
  );
  if (duplicate) {
    void vscode.window.showWarningMessage(
      "An environment for this URL already exists in this scope. Remove it before adding a new one."
    );
    return;
  }

  const username = await promptOptionalInput("Username (optional)");
  if (username === undefined) {
    return;
  }

  const token = await promptOptionalInput("API Token (optional)", undefined, true);
  if (token === undefined) {
    return;
  }

  const normalizedUsername = username.trim();
  const normalizedToken = token.trim();

  if (normalizedToken.length > 0 && normalizedUsername.length === 0) {
    void vscode.window.showErrorMessage("Username is required when an API token is provided.");
    return;
  }

  const environment: JenkinsEnvironment = {
    id: crypto.randomUUID(),
    url,
    username: normalizedUsername.length > 0 ? normalizedUsername : undefined
  };

  await store.addEnvironment(
    scope,
    environment,
    normalizedToken.length > 0 ? normalizedToken : undefined
  );
  refreshHost.refreshEnvironment(environment.id);
}

export async function removeEnvironment(
  store: JenkinsEnvironmentStore,
  watchStore: JenkinsWatchStore,
  clientProvider: JenkinsClientProvider,
  refreshHost: EnvironmentCommandRefreshHost,
  item?: JenkinsEnvironmentRef
): Promise<void> {
  let target:
    | {
        id: string;
        url: string;
        scope: EnvironmentScope;
      }
    | undefined;

  if (item) {
    target = {
      id: item.environmentId,
      url: item.url,
      scope: item.scope
    };
  } else {
    const environments = await store.listEnvironmentsWithScope();
    if (environments.length === 0) {
      void vscode.window.showInformationMessage("No environments are available to remove.");
      return;
    }

    const picks = environments.map((environment) => ({
      label: environment.url,
      description: formatScopeLabel(environment.scope),
      target: {
        id: environment.id,
        url: environment.url,
        scope: environment.scope
      }
    }));

    const pick = await vscode.window.showQuickPick(picks, {
      placeHolder: "Select an environment to remove",
      matchOnDescription: true
    });

    if (!pick) {
      return;
    }

    target = pick.target;
  }

  const removed = await store.removeEnvironment(target.scope, target.id);
  if (removed) {
    await watchStore.removeWatchesForEnvironment(target.scope, target.id);
    clientProvider.invalidateClient(target.scope, target.id);
    refreshHost.onEnvironmentRemoved?.({
      environmentId: target.id,
      scope: target.scope,
      url: target.url
    });
    refreshHost.refreshEnvironment(target.id);
  }
}

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../../jenkins/types";
import type {
  EnvironmentScope,
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { EnvironmentCommandRefreshHost } from "./EnvironmentCommandTypes";
import {
  promptAuthMode,
  promptHeadersJson,
  promptRequiredInput,
  promptScope
} from "./EnvironmentPrompts";

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

  const authMode = await promptAuthMode();
  if (!authMode) {
    return;
  }

  let authConfig: JenkinsAuthConfig | undefined;

  if (authMode === "basic") {
    const authUsername = await promptRequiredInput("Username");
    if (!authUsername) {
      return;
    }
    const authToken = await promptRequiredInput("API Token", undefined, true);
    if (!authToken) {
      return;
    }
    authConfig = {
      type: "basic",
      username: authUsername,
      token: authToken
    };
  } else if (authMode === "bearer") {
    const token = await promptRequiredInput("Bearer Token", undefined, true);
    if (!token) {
      return;
    }
    authConfig = {
      type: "bearer",
      token
    };
  } else if (authMode === "cookie") {
    const cookie = await promptRequiredInput("Cookie Header Value", undefined, true);
    if (!cookie) {
      return;
    }
    authConfig = {
      type: "cookie",
      cookie
    };
  } else if (authMode === "headers") {
    const headers = await promptHeadersJson();
    if (!headers) {
      return;
    }
    authConfig = {
      type: "headers",
      headers
    };
  } else {
    authConfig = { type: "none" };
  }

  const environment: JenkinsEnvironment = {
    id: crypto.randomUUID(),
    url
  };

  await store.addEnvironment(scope, environment);
  if (authConfig) {
    await store.setAuthConfig(scope, environment.id, authConfig);
  }
  refreshHost.refreshEnvironment(environment.id);
}

export async function removeEnvironment(
  store: JenkinsEnvironmentStore,
  presetStore: JenkinsParameterPresetStore,
  watchStore: JenkinsWatchStore,
  pinStore: JenkinsPinStore,
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
    await presetStore.removePresetsForEnvironment(target.scope, target.id);
    await watchStore.removeWatchesForEnvironment(target.scope, target.id);
    await pinStore.removePinsForEnvironment(target.scope, target.id);
    clientProvider.invalidateClient(target.scope, target.id);
    refreshHost.onEnvironmentRemoved?.({
      environmentId: target.id,
      scope: target.scope,
      url: target.url
    });
    refreshHost.refreshEnvironment(target.id);
  }
}

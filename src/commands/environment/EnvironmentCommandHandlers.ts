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
  type EnvironmentAuthMode,
  promptAuthMode,
  promptHeadersJson,
  promptRequiredInput,
  promptScope
} from "./EnvironmentPrompts";

type EnvironmentTarget = {
  id: string;
  url: string;
  scope: EnvironmentScope;
};

function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function normalizeJenkinsUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    const trimmed = url.trim();
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }

  if (!parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }

  return parsed.toString();
}

async function promptAuthConfig(
  authMode: EnvironmentAuthMode
): Promise<JenkinsAuthConfig | undefined> {
  switch (authMode) {
    case "none":
      return { type: "none" };
    case "basic": {
      const authUsername = await promptRequiredInput("Username");
      if (!authUsername) {
        return undefined;
      }
      const authToken = await promptRequiredInput("API Token", undefined, true);
      if (!authToken) {
        return undefined;
      }
      return {
        type: "basic",
        username: authUsername,
        token: authToken
      };
    }
    case "bearer": {
      const token = await promptRequiredInput("Bearer Token", undefined, true);
      if (!token) {
        return undefined;
      }
      return {
        type: "bearer",
        token
      };
    }
    case "cookie": {
      const cookie = await promptRequiredInput("Cookie Header Value", undefined, true);
      if (!cookie) {
        return undefined;
      }
      return {
        type: "cookie",
        cookie
      };
    }
    case "headers": {
      const headers = await promptHeadersJson();
      if (!headers) {
        return undefined;
      }
      return {
        type: "headers",
        headers
      };
    }
    default:
      return undefined;
  }
}

function toEnvironmentTarget(
  environment:
    | JenkinsEnvironmentRef
    | {
        id: string;
        url: string;
        scope: EnvironmentScope;
      }
): EnvironmentTarget {
  if ("environmentId" in environment) {
    return {
      id: environment.environmentId,
      url: environment.url,
      scope: environment.scope
    };
  }

  return environment;
}

async function promptEnvironmentRemovalTarget(
  store: JenkinsEnvironmentStore
): Promise<EnvironmentTarget | undefined> {
  const environments = await store.listEnvironmentsWithScope();
  if (environments.length === 0) {
    void vscode.window.showInformationMessage("No environments are available to remove.");
    return undefined;
  }

  const picks = environments.map((environment) => ({
    label: environment.url,
    description: formatScopeLabel(environment.scope),
    target: toEnvironmentTarget(environment)
  }));

  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: "Select an environment to remove",
    matchOnDescription: true
  });

  return pick?.target;
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

  if (!parseHttpUrl(rawUrl)) {
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

  const authConfig = await promptAuthConfig(authMode);
  if (!authConfig) {
    return;
  }

  const environment: JenkinsEnvironment = {
    id: crypto.randomUUID(),
    url
  };

  await store.addEnvironment(scope, environment);
  await store.setAuthConfig(scope, environment.id, authConfig);
  refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
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
  const target = item ? toEnvironmentTarget(item) : await promptEnvironmentRemovalTarget(store);
  if (!target) {
    return;
  }

  const removed = await store.removeEnvironment(target.scope, target.id);
  if (!removed) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return;
  }

  await Promise.all([
    presetStore.removePresetsForEnvironment(target.scope, target.id),
    watchStore.removeWatchesForEnvironment(target.scope, target.id),
    pinStore.removePinsForEnvironment(target.scope, target.id)
  ]);
  clientProvider.invalidateClient(target.scope, target.id);
  refreshHost.onEnvironmentRemoved?.({
    environmentId: target.id,
    scope: target.scope,
    url: target.url
  });
  refreshHost.fullEnvironmentRefresh({ environmentId: target.id });
}

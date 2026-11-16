import * as vscode from "vscode";
import { formatError } from "../../formatters/ErrorFormatters";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../../jenkins/types";
import type {
  EnvironmentScope,
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";

// Re-exported so existing callers keep importing the URL helpers from here.
export { normalizeJenkinsUrl, parseHttpUrl } from "../../environments/EnvironmentUrlValidation";

type EnvironmentTarget = {
  id: string;
  url: string;
  scope: EnvironmentScope;
  name?: string;
};

export const INVALID_URL_MESSAGE =
  "Invalid Jenkins URL. Enter an HTTP or HTTPS base URL without embedded credentials, query parameters, or fragments. Configure credentials using the authentication prompts.";

export function redactJenkinsUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url.trim());
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function formatJenkinsUrlForDisplay(url: string): string {
  return redactJenkinsUrl(url) ?? "Invalid Jenkins URL";
}

/** The environment's name, else its URL with any legacy embedded credentials removed. */
export function formatEnvironmentTitle(environment: { name?: string; url: string }): string {
  const name = environment.name?.trim();
  return name ? name : formatJenkinsUrlForDisplay(environment.url);
}

export function toEnvironmentTarget(
  environment: JenkinsEnvironmentRef | EnvironmentTarget
): EnvironmentTarget {
  if ("environmentId" in environment) {
    return {
      id: environment.environmentId,
      url: environment.url,
      scope: environment.scope,
      ...(environment.name ? { name: environment.name } : {})
    };
  }

  return environment;
}

export async function promptEnvironmentTarget(
  store: JenkinsEnvironmentStore,
  copy: {
    emptyMessage: string;
    placeHolder: string;
  }
): Promise<EnvironmentTarget | undefined> {
  const environments = await store.listEnvironmentsWithScope();
  if (environments.length === 0) {
    void vscode.window.showInformationMessage(copy.emptyMessage);
    return undefined;
  }

  const picks = environments.map((environment) => {
    const name = environment.name?.trim();
    return {
      label: formatEnvironmentTitle(environment),
      description: formatScopeLabel(environment.scope),
      detail: name ? formatJenkinsUrlForDisplay(environment.url) : undefined,
      target: {
        id: environment.id,
        url: environment.url,
        scope: environment.scope,
        ...(name ? { name } : {})
      }
    };
  });

  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: copy.placeHolder,
    matchOnDescription: true,
    matchOnDetail: true
  });

  return pick?.target;
}

/** Resolves stored settings rather than trusting references retained by tree items or panels. */
export async function resolveSavedEnvironment(
  store: JenkinsEnvironmentStore,
  target: { scope: EnvironmentScope; id: string },
  warnIfMissing = true
): Promise<JenkinsEnvironment | undefined> {
  const environment = (await store.getEnvironments(target.scope)).find(
    (entry) => entry.id === target.id
  );
  if (!environment && warnIfMissing) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
  }
  return environment;
}

/** Saves credentials only while the revision shown to the user is still current. */
export async function saveEnvironmentAuthConfig(
  store: JenkinsEnvironmentStore,
  target: { scope: EnvironmentScope; id: string; url: string; name?: string },
  authConfig: JenkinsAuthConfig,
  revision: number,
  conflictMessage: string
): Promise<boolean> {
  let saved: boolean;
  try {
    saved = await store.setAuthConfigIfRevision(target.scope, target.id, authConfig, revision);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Unable to store authentication settings for ${formatEnvironmentTitle(target)}: ${formatError(error)}`
    );
    return false;
  }
  if (!saved) {
    void vscode.window.showWarningMessage(conflictMessage);
  }
  return saved;
}

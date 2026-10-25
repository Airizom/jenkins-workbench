import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentScope,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";

type EnvironmentTarget = {
  id: string;
  url: string;
  scope: EnvironmentScope;
  name?: string;
};

export const INVALID_URL_MESSAGE =
  "Invalid Jenkins URL. Enter an HTTP or HTTPS base URL without embedded credentials, query parameters, or fragments. Configure credentials using the authentication prompts.";

export function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

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

export function normalizeJenkinsUrl(url: string): string {
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

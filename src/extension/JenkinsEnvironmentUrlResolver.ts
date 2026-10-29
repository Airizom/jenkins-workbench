import * as vscode from "vscode";
import { formatEnvironmentDisplayName } from "../jenkins/EnvironmentLabels";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash } from "../jenkins/urls";
import type {
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../storage/JenkinsEnvironmentStore";

export interface ResolvedEnvironmentUrl {
  environment: JenkinsEnvironmentRef;
  /** The matched environment's base URL, normalized with a trailing slash. */
  environmentUrl: string;
}

interface EnvironmentMatch {
  environment: EnvironmentWithScope;
  normalizedUrl: string;
}

interface EnvironmentPickItem extends vscode.QuickPickItem {
  match: EnvironmentMatch;
}

const ADD_ENVIRONMENT_ACTION = "Add Environment…";

/**
 * Maps an absolute Jenkins URL to the configured environment whose base URL prefixes it.
 */
export class JenkinsEnvironmentUrlResolver {
  constructor(private readonly environmentStore: JenkinsEnvironmentStore) {}

  async resolve(url: URL): Promise<ResolvedEnvironmentUrl | undefined> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      void vscode.window.showErrorMessage(
        "No Jenkins environments are configured. Add one in Jenkins Workbench first."
      );
      return undefined;
    }

    const matches = findMatches(environments, url);

    if (matches.length === 0) {
      void vscode.window
        .showErrorMessage(
          "No Jenkins environment matches the provided URL. Verify the base URL in settings.",
          ADD_ENVIRONMENT_ACTION
        )
        .then((choice) => {
          if (choice === ADD_ENVIRONMENT_ACTION) {
            void vscode.commands.executeCommand("jenkinsWorkbench.addEnvironment");
          }
        });
      return undefined;
    }

    if (matches.length === 1) {
      return toResolved(matches[0]);
    }

    const items: EnvironmentPickItem[] = matches.map((match) => ({
      label: formatEnvironmentDisplayName(match.environment),
      description: match.environment.scope,
      detail: match.normalizedUrl,
      match
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select the Jenkins environment for this link"
    });

    return selection ? toResolved(selection.match) : undefined;
  }

  async hasMatch(url: URL): Promise<boolean> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    return findMatches(environments, url).length > 0;
  }
}

/**
 * Keeps only the most specific base URLs, so https://ci/legacy/ wins over https://ci/ for
 * https://ci/legacy/job/a/. Environments with the same base URL in different scopes still tie.
 */
function findMatches(environments: EnvironmentWithScope[], url: URL): EnvironmentMatch[] {
  const targetValue = url.toString();
  const matches: EnvironmentMatch[] = [];
  for (const environment of environments) {
    const normalizedUrl = normalizeEnvironmentUrl(environment.url);
    if (normalizedUrl && targetValue.startsWith(normalizedUrl)) {
      matches.push({ environment, normalizedUrl });
    }
  }
  const longest = Math.max(0, ...matches.map((match) => match.normalizedUrl.length));
  return matches.filter((match) => match.normalizedUrl.length === longest);
}

function toResolved(match: EnvironmentMatch): ResolvedEnvironmentUrl {
  return {
    environment: toJenkinsEnvironmentRef(match.environment),
    environmentUrl: match.normalizedUrl
  };
}

function normalizeEnvironmentUrl(value: string): string | undefined {
  try {
    return ensureTrailingSlash(new URL(value).toString());
  } catch {
    return undefined;
  }
}

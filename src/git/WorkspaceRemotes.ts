import type * as vscode from "vscode";
import { stripHttpUrlCredentials } from "../jenkins/urls";
import type { GitRepository } from "./GitExtensionApi";

export interface WorkspaceRemote {
  name: string;
  /** Safe to send to Jenkins: tokens embedded in http(s) remotes are removed. */
  url: string;
  repositoryRootUri: vscode.Uri;
}

/**
 * One entry per distinct remote URL across the workspace's Git repositories, preferring the
 * fetch URL. Remotes cloned as `https://user:token@host/...` lose the credentials, so the token
 * never ends up in a Jenkins configuration.
 */
export function listWorkspaceRemotes(repositories: readonly GitRepository[]): WorkspaceRemote[] {
  const remotes: WorkspaceRemote[] = [];
  const seenUrls = new Set<string>();
  for (const repository of repositories) {
    for (const remote of repository.state.remotes ?? []) {
      const rawUrl = (remote.fetchUrl ?? remote.pushUrl)?.trim();
      const url = rawUrl ? stripHttpUrlCredentials(rawUrl) : undefined;
      if (!url || seenUrls.has(url)) {
        continue;
      }
      seenUrls.add(url);
      remotes.push({ name: remote.name, url, repositoryRootUri: repository.rootUri });
    }
  }
  return remotes;
}

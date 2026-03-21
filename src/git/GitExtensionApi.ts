import * as vscode from "vscode";

export interface GitExtension {
  getAPI(version: 1): GitApi;
}

export interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
  ui?: GitRepositoryUiState;
}

export interface GitRepositoryState {
  HEAD?: GitRef;
  onDidChange: vscode.Event<void>;
}

export interface GitRepositoryUiState {
  selected?: boolean;
  onDidChange?: vscode.Event<void>;
}

export enum GitRefType {
  Head = 0,
  RemoteHead = 1,
  Tag = 2
}

export interface GitRef {
  name?: string;
  type?: GitRefType;
}

export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    return undefined;
  }

  if (!extension.isActive) {
    await extension.activate();
  }

  const api = extension.exports?.getAPI?.(1);
  return api;
}

export function getAttachedBranchName(head?: GitRef): string | undefined {
  const name = head?.name?.trim();
  if (!name) {
    return undefined;
  }

  if (typeof head?.type !== "undefined" && head.type !== GitRefType.Head) {
    return undefined;
  }

  return name;
}

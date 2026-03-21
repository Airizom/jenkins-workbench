import * as path from "node:path";
import type * as vscode from "vscode";
import type { GitRepository } from "../git/GitExtensionApi";
import type {
  CurrentBranchRepositoryContext,
  CurrentBranchRepositoryInfo
} from "./CurrentBranchTypes";

export function toRepositoryContext(repository: GitRepository): CurrentBranchRepositoryContext {
  return {
    repository,
    repositoryUri: repository.rootUri,
    repositoryUriString: repository.rootUri.toString(),
    repositoryLabel: path.basename(repository.rootUri.fsPath),
    repositoryPath: repository.rootUri.fsPath
  };
}

export function toRepositoryInfo(
  repository: CurrentBranchRepositoryContext
): CurrentBranchRepositoryInfo {
  return {
    repositoryUriString: repository.repositoryUriString,
    repositoryLabel: repository.repositoryLabel,
    repositoryPath: repository.repositoryPath
  };
}

export function isUriInside(candidate: vscode.Uri, root: vscode.Uri): boolean {
  if (candidate.scheme !== root.scheme || candidate.authority !== root.authority) {
    return false;
  }

  const relative = path.relative(root.fsPath, candidate.fsPath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

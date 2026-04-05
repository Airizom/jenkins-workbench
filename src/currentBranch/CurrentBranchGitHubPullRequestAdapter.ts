import * as vscode from "vscode";
import type { CurrentBranchRepositoryContext } from "./CurrentBranchTypes";

const GITHUB_PULL_REQUEST_EXTENSION_IDS = [
  "GitHub.vscode-pull-request-github",
  "GitHub.vscode-pull-request-github-insiders"
] as const;

interface GitHubPullRequestExtensionApi {
  getRepositoryDescription(uri: vscode.Uri): Promise<GitHubRepositoryDescription | undefined>;
}

interface GitHubRepositoryDescription {
  pullRequest?: {
    number?: number;
    title?: string;
    url?: string;
  };
}

export interface CurrentBranchGitHubPullRequestSnapshot {
  pullRequest?: {
    number: number;
    title?: string;
    url?: string;
  };
}

export type CurrentBranchGitHubPullRequestLookupResult =
  | {
      kind: "available";
      snapshot: CurrentBranchGitHubPullRequestSnapshot;
    }
  | {
      kind: "unavailable";
      reason: "extensionMissing" | "repositoryMetadataUnavailable" | "requestFailed";
      detail?: string;
    };

export interface CurrentBranchGitHubPullRequestAdapter {
  lookup(
    repository: CurrentBranchRepositoryContext
  ): Promise<CurrentBranchGitHubPullRequestLookupResult>;
}

export class VscodeCurrentBranchGitHubPullRequestAdapter
  implements CurrentBranchGitHubPullRequestAdapter
{
  async lookup(
    repository: CurrentBranchRepositoryContext
  ): Promise<CurrentBranchGitHubPullRequestLookupResult> {
    const extension = findGitHubPullRequestExtension();
    if (!extension) {
      return {
        kind: "unavailable",
        reason: "extensionMissing"
      };
    }

    try {
      const exportsValue = extension.isActive ? extension.exports : await extension.activate();
      if (!isGitHubPullRequestExtensionApi(exportsValue)) {
        return {
          kind: "unavailable",
          reason: "repositoryMetadataUnavailable"
        };
      }

      const description = await exportsValue.getRepositoryDescription(repository.repositoryUri);
      return {
        kind: "available",
        snapshot: {
          pullRequest: normalizeRepositoryPullRequest(description?.pullRequest)
        }
      };
    } catch (error) {
      return {
        kind: "unavailable",
        reason: "requestFailed",
        detail: formatError(error)
      };
    }
  }
}

function findGitHubPullRequestExtension(): vscode.Extension<unknown> | undefined {
  for (const extensionId of GITHUB_PULL_REQUEST_EXTENSION_IDS) {
    const extension = vscode.extensions.getExtension(extensionId);
    if (extension) {
      return extension;
    }
  }

  return undefined;
}

function isGitHubPullRequestExtensionApi(value: unknown): value is GitHubPullRequestExtensionApi {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "getRepositoryDescription") === "function"
  );
}

function normalizeRepositoryPullRequest(
  pullRequest: GitHubRepositoryDescription["pullRequest"]
): CurrentBranchGitHubPullRequestSnapshot["pullRequest"] | undefined {
  if (!pullRequest || typeof pullRequest.number !== "number") {
    return undefined;
  }

  return {
    number: pullRequest.number,
    title: normalizeString(pullRequest.title),
    url: normalizeString(pullRequest.url)
  };
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

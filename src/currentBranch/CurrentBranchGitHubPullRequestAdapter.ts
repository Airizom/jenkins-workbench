import * as vscode from "vscode";
import { formatError } from "../formatters/ErrorFormatters";
import { firstNonEmpty, trimToUndefined } from "../shared/stringValues";
import type {
  CurrentBranchPullRequestInfo,
  CurrentBranchRepositoryContext
} from "./CurrentBranchTypes";

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
    headRefName?: string;
    head?: { ref?: string };
  };
}

export type CurrentBranchPullRequestResolution =
  | {
      kind: "none";
    }
  | ({
      kind: "pullRequest";
    } & CurrentBranchPullRequestInfo)
  | {
      kind: "unavailable";
      reason: "extensionMissing" | "repositoryMetadataUnavailable" | "requestFailed";
      detail?: string;
    };

export interface CurrentBranchGitHubPullRequestAdapter {
  lookup(repository: CurrentBranchRepositoryContext): Promise<CurrentBranchPullRequestResolution>;
}

export class VscodeCurrentBranchGitHubPullRequestAdapter
  implements CurrentBranchGitHubPullRequestAdapter
{
  async lookup(
    repository: CurrentBranchRepositoryContext
  ): Promise<CurrentBranchPullRequestResolution> {
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
      const pullRequest = normalizeRepositoryPullRequest(description?.pullRequest);
      if (!pullRequest) {
        return { kind: "none" };
      }

      return {
        kind: "pullRequest",
        ...pullRequest
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
): CurrentBranchPullRequestInfo | undefined {
  if (!pullRequest || typeof pullRequest.number !== "number") {
    return undefined;
  }

  return {
    number: pullRequest.number,
    title: trimToUndefined(pullRequest.title),
    url: trimToUndefined(pullRequest.url),
    // The extension API is duck-typed; accept both GraphQL- and REST-shaped head refs.
    headBranch: firstNonEmpty(pullRequest.headRefName, pullRequest.head?.ref)
  };
}

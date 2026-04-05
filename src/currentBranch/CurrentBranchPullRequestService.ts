import type { CurrentBranchGitHubPullRequestAdapter } from "./CurrentBranchGitHubPullRequestAdapter";
import type {
  CurrentBranchPullRequestInfo,
  CurrentBranchRepositoryContext
} from "./CurrentBranchTypes";

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

export class CurrentBranchPullRequestService {
  constructor(private readonly githubPullRequestAdapter: CurrentBranchGitHubPullRequestAdapter) {}

  async resolve(
    repository: CurrentBranchRepositoryContext
  ): Promise<CurrentBranchPullRequestResolution> {
    const result = await this.githubPullRequestAdapter.lookup(repository);
    if (result.kind === "unavailable") {
      return result;
    }

    const { pullRequest } = result.snapshot;
    if (!pullRequest) {
      return { kind: "none" };
    }

    return {
      kind: "pullRequest",
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url
    };
  }
}

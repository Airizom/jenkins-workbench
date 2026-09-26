import type { GitRepository } from "../git/GitExtensionApi";
import { fullGitRevision, normalizeRepositoryUrl } from "../jenkins/JenkinsRevisionEvidence";

export interface CurrentBranchCheckout {
  head?: string;
  branch?: string;
  repositories: string[];
  dirty: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export function captureCheckout(repository: GitRepository): CurrentBranchCheckout {
  const state = repository.state;
  const head = state.HEAD;
  return {
    head: fullGitRevision(head?.commit),
    branch: head?.name,
    repositories: [
      ...new Set(
        (state.remotes ?? [])
          .flatMap((remote) => [remote.fetchUrl, remote.pushUrl])
          .filter((url): url is string => !!url)
          .map(normalizeRepositoryUrl)
          .filter((url): url is string => !!url)
      )
    ].sort(),
    dirty: !!(
      state.workingTreeChanges?.length ||
      state.untrackedChanges?.length ||
      state.indexChanges?.length ||
      state.mergeChanges?.length
    ),
    upstream: head?.upstream ? `${head.upstream.remote}/${head.upstream.name}` : undefined,
    ahead: head?.upstream ? head.ahead : undefined,
    behind: head?.upstream ? head.behind : undefined
  };
}

export function checkoutFingerprint(repository: GitRepository): string {
  return JSON.stringify(captureCheckout(repository));
}

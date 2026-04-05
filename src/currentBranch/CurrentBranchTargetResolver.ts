import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { CurrentBranchPullRequestJobMatcher } from "./CurrentBranchPullRequestJobMatcher";
import type {
  CurrentBranchPullRequestResolution,
  CurrentBranchPullRequestService
} from "./CurrentBranchPullRequestService";
import type {
  CurrentBranchLinkedContext,
  CurrentBranchPullRequestInfo,
  CurrentBranchRefreshOptions,
  CurrentBranchSelectedTargetInfo
} from "./CurrentBranchTypes";

interface CachedPullRequestContext {
  expiresAt: number;
  context: CurrentBranchPullRequestResolution;
}

interface CachedTargetResolution {
  expiresAt: number;
  resolution: CurrentBranchTargetResolution;
}

const PULL_REQUEST_CONTEXT_CACHE_TTL_MS = 5_000;
const TARGET_RESOLUTION_CACHE_TTL_MS = 5_000;

export type CurrentBranchResolvedTarget = {
  branchName: string;
  link: CurrentBranchLinkedContext["link"];
  environment: CurrentBranchLinkedContext["environment"];
  selectedTarget: CurrentBranchSelectedTargetInfo;
};

export type CurrentBranchTargetResolution =
  | {
      kind: "selected";
      cacheKey: string;
      target: CurrentBranchResolvedTarget;
    }
  | {
      kind: "branchMissing";
      cacheKey: string;
      branchName: string;
      link: CurrentBranchLinkedContext["link"];
      environment: CurrentBranchLinkedContext["environment"];
    };

export class CurrentBranchTargetResolver {
  private readonly pullRequestContextCache = new Map<string, CachedPullRequestContext>();
  private readonly targetResolutionCache = new Map<string, CachedTargetResolution>();

  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly pullRequestService: CurrentBranchPullRequestService,
    private readonly pullRequestJobMatcher: CurrentBranchPullRequestJobMatcher
  ) {}

  dispose(): void {
    this.pullRequestContextCache.clear();
    this.targetResolutionCache.clear();
  }

  async resolve(
    localState: CurrentBranchLinkedContext,
    options: CurrentBranchRefreshOptions
  ): Promise<CurrentBranchTargetResolution> {
    const pullRequestContext = await this.resolvePullRequestContext(localState, options);
    const cacheKey = buildTargetResolutionCacheKey(localState, pullRequestContext);
    if (!options.force) {
      const cached = this.targetResolutionCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.resolution;
      }
    }

    const resolution = await this.fetchTargetResolution(localState, pullRequestContext, cacheKey);
    this.targetResolutionCache.set(cacheKey, {
      expiresAt: Date.now() + TARGET_RESOLUTION_CACHE_TTL_MS,
      resolution
    });
    return resolution;
  }

  private async resolvePullRequestContext(
    localState: CurrentBranchLinkedContext,
    options: CurrentBranchRefreshOptions
  ): Promise<CurrentBranchPullRequestResolution> {
    const cacheKey = buildPullRequestContextCacheKey(localState);
    if (!options.force) {
      const cached = this.pullRequestContextCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.context;
      }
    }

    const context = await this.pullRequestService.resolve(localState.repository);
    this.pullRequestContextCache.set(cacheKey, {
      expiresAt: Date.now() + PULL_REQUEST_CONTEXT_CACHE_TTL_MS,
      context
    });
    return context;
  }

  private async fetchTargetResolution(
    localState: CurrentBranchLinkedContext,
    pullRequestContext: CurrentBranchPullRequestResolution,
    cacheKeyBase: string
  ): Promise<CurrentBranchTargetResolution> {
    const jobs = await this.dataService.getJobsForFolder(
      localState.environment,
      localState.link.multibranchFolderUrl,
      { mode: "refresh" }
    );

    const pullRequestTarget = this.selectPullRequestTarget(localState, jobs, pullRequestContext);
    if (pullRequestTarget) {
      return {
        kind: "selected",
        cacheKey: `${cacheKeyBase}::target:pullRequest:${pullRequestTarget.selectedTarget.jobUrl}`,
        target: pullRequestTarget
      };
    }

    const branchLookupName = resolveBranchLookupName(localState, pullRequestContext);
    const branchTarget = this.selectBranchTarget(localState, jobs, branchLookupName);
    if (branchTarget) {
      return {
        kind: "selected",
        cacheKey: `${cacheKeyBase}::target:branch:${branchTarget.selectedTarget.jobUrl}`,
        target: branchTarget
      };
    }

    return {
      kind: "branchMissing",
      cacheKey: `${cacheKeyBase}::target:missing:${branchLookupName}`,
      branchName: branchLookupName,
      link: localState.link,
      environment: localState.environment
    };
  }

  private selectPullRequestTarget(
    localState: CurrentBranchLinkedContext,
    jobs: Array<{ name: string; url: string; color?: string }>,
    pullRequestContext: CurrentBranchPullRequestResolution
  ): CurrentBranchResolvedTarget | undefined {
    const pullRequestMatch = this.pullRequestJobMatcher.findMatch(jobs, pullRequestContext);
    if (!pullRequestMatch) {
      return undefined;
    }

    return {
      branchName: localState.branchName,
      link: localState.link,
      environment: localState.environment,
      selectedTarget: createSelectedTargetInfo(pullRequestMatch.job, "pullRequest", {
        number: pullRequestMatch.pullRequest.number,
        title: pullRequestMatch.pullRequest.title,
        url: pullRequestMatch.pullRequest.url,
        headBranch: pullRequestMatch.pullRequest.headBranch
      })
    };
  }

  private selectBranchTarget(
    localState: CurrentBranchLinkedContext,
    jobs: Array<{ name: string; url: string; color?: string }>,
    branchName: string
  ): CurrentBranchResolvedTarget | undefined {
    const branchMatch = jobs.find((job) => matchesBranchName(job.name, branchName));
    if (!branchMatch) {
      return undefined;
    }

    return {
      branchName,
      link: localState.link,
      environment: localState.environment,
      selectedTarget: createSelectedTargetInfo(branchMatch, "branch")
    };
  }
}

function resolveBranchLookupName(
  localState: CurrentBranchLinkedContext,
  pullRequestContext: CurrentBranchPullRequestResolution
): string {
  return pullRequestContext.kind === "pullRequest" && pullRequestContext.headBranch
    ? pullRequestContext.headBranch
    : localState.branchName;
}

function buildPullRequestContextCacheKey(localState: CurrentBranchLinkedContext): string {
  return [localState.repository.repositoryUriString, localState.branchName].join("::");
}

function buildTargetResolutionCacheKey(
  localState: CurrentBranchLinkedContext,
  pullRequestContext: CurrentBranchPullRequestResolution
): string {
  return [
    localState.repository.repositoryUriString,
    localState.environment.scope,
    localState.environment.environmentId,
    localState.environment.url,
    localState.link.multibranchFolderUrl,
    localState.branchName,
    buildPullRequestContextCacheDiscriminator(pullRequestContext)
  ].join("::");
}

function buildPullRequestContextCacheDiscriminator(
  pullRequestContext: CurrentBranchPullRequestResolution
): string {
  switch (pullRequestContext.kind) {
    case "pullRequest":
      return `pullRequest:${pullRequestContext.number}`;
    case "none":
      return "pullRequest:none";
    case "unavailable":
      return `pullRequest:unavailable:${pullRequestContext.reason}`;
  }
}

function createSelectedTargetInfo(
  job: { name: string; url: string; color?: string },
  kind: CurrentBranchSelectedTargetInfo["kind"],
  pullRequest?: CurrentBranchPullRequestInfo
): CurrentBranchSelectedTargetInfo {
  return {
    kind,
    jobName: decodeJenkinsJobName(job.name),
    jobUrl: job.url,
    jobColor: job.color,
    pullRequest
  };
}

function matchesBranchName(jobName: string, branchName: string): boolean {
  return jobName === branchName || decodeJenkinsJobName(jobName) === branchName;
}

function decodeJenkinsJobName(jobName: string): string {
  try {
    return decodeURIComponent(jobName);
  } catch {
    return jobName;
  }
}

import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { toRepositoryInfo } from "./CurrentBranchRepositoryUtils";
import type {
  CurrentBranchLinkedContext,
  CurrentBranchRefreshOptions,
  CurrentBranchRemoteResolvedState,
  CurrentBranchState
} from "./CurrentBranchTypes";

interface CachedRemoteResolvedState {
  expiresAt: number;
  state: CurrentBranchRemoteResolvedState;
}

const REMOTE_RESOLUTION_CACHE_TTL_MS = 5_000;

export class CurrentBranchStatusResolver {
  private readonly remoteStateCache = new Map<string, CachedRemoteResolvedState>();

  constructor(private readonly dataService: JenkinsDataService) {}

  dispose(): void {
    this.remoteStateCache.clear();
  }

  async resolve(
    localState: CurrentBranchLinkedContext,
    options: CurrentBranchRefreshOptions
  ): Promise<CurrentBranchState> {
    const cacheKey = buildRemoteStateCacheKey(localState);
    if (!options.force) {
      const cached = this.remoteStateCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return this.materializeRemoteState(localState, cached.state);
      }
    }

    const resolved = await this.fetchRemoteState(localState);
    this.remoteStateCache.set(cacheKey, {
      expiresAt: Date.now() + REMOTE_RESOLUTION_CACHE_TTL_MS,
      state: resolved
    });
    return this.materializeRemoteState(localState, resolved);
  }

  private async fetchRemoteState(
    localState: CurrentBranchLinkedContext
  ): Promise<CurrentBranchRemoteResolvedState> {
    try {
      const jobs = await this.dataService.getJobsForFolder(
        localState.environment,
        localState.link.multibranchFolderUrl,
        { mode: "refresh" }
      );
      const match = jobs.find((job) => matchesBranchName(job.name, localState.branchName));
      if (!match) {
        return {
          kind: "branchMissing",
          branchName: localState.branchName,
          link: localState.link,
          environment: localState.environment
        };
      }

      const jobDetails = await this.dataService.getJob(localState.environment, match.url);
      return {
        kind: "matched",
        branchName: localState.branchName,
        link: localState.link,
        environment: localState.environment,
        jobName: decodeJenkinsJobName(match.name),
        jobUrl: match.url,
        jobColor: match.color,
        lastBuild: jobDetails.lastBuild
          ? {
              url: jobDetails.lastBuild.url,
              number: jobDetails.lastBuild.number,
              result: jobDetails.lastBuild.result,
              building: jobDetails.lastBuild.building,
              timestamp: jobDetails.lastBuild.timestamp
            }
          : undefined
      };
    } catch (error) {
      return {
        kind: "requestFailed",
        branchName: localState.branchName,
        link: localState.link,
        environment: localState.environment,
        message: error instanceof Error ? error.message : "Unable to resolve current branch."
      };
    }
  }

  private materializeRemoteState(
    localState: CurrentBranchLinkedContext,
    remoteState: CurrentBranchRemoteResolvedState
  ): CurrentBranchState {
    return {
      ...remoteState,
      repository: toRepositoryInfo(localState.repository)
    };
  }
}

function buildRemoteStateCacheKey(localState: CurrentBranchLinkedContext): string {
  return [
    localState.repository.repositoryUriString,
    localState.environment.scope,
    localState.environment.environmentId,
    localState.environment.url,
    localState.link.multibranchFolderUrl,
    localState.branchName
  ].join("::");
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

import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { toRepositoryInfo } from "./CurrentBranchRepositoryUtils";
import type {
  CurrentBranchResolvedTarget,
  CurrentBranchTargetResolver
} from "./CurrentBranchTargetResolver";
import type {
  CurrentBranchBuildInfo,
  CurrentBranchLinkedContext,
  CurrentBranchRefreshOptions,
  CurrentBranchRemoteResolvedState,
  CurrentBranchSelectedTargetInfo,
  CurrentBranchState
} from "./CurrentBranchTypes";

interface CachedRemoteResolvedState {
  expiresAt: number;
  state: CurrentBranchRemoteResolvedState;
}

const REMOTE_RESOLUTION_CACHE_TTL_MS = 5_000;

export class CurrentBranchStatusResolver {
  private readonly remoteStateCache = new Map<string, CachedRemoteResolvedState>();

  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly targetResolver: CurrentBranchTargetResolver
  ) {}

  dispose(): void {
    this.remoteStateCache.clear();
    this.targetResolver.dispose();
  }

  async resolve(
    localState: CurrentBranchLinkedContext,
    options: CurrentBranchRefreshOptions
  ): Promise<CurrentBranchState> {
    try {
      const targetResolution = await this.targetResolver.resolve(localState, options);
      const cacheKey = targetResolution.cacheKey;
      if (!options.force) {
        const cached = this.remoteStateCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return this.materializeRemoteState(localState, cached.state);
        }
      }

      const resolved =
        targetResolution.kind === "selected"
          ? await this.hydrateSelectedTarget(targetResolution.target)
          : {
              kind: "branchMissing" as const,
              branchName: targetResolution.branchName,
              link: targetResolution.link,
              environment: targetResolution.environment
            };
      this.remoteStateCache.set(cacheKey, {
        expiresAt: Date.now() + REMOTE_RESOLUTION_CACHE_TTL_MS,
        state: resolved
      });
      return this.materializeRemoteState(localState, resolved);
    } catch (error) {
      return this.materializeRemoteState(localState, {
        kind: "requestFailed",
        branchName: localState.branchName,
        link: localState.link,
        environment: localState.environment,
        message: toResolutionErrorMessage(error)
      });
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

  private async hydrateSelectedTarget(
    target: CurrentBranchResolvedTarget
  ): Promise<CurrentBranchRemoteResolvedState> {
    try {
      const jobDetails = await this.dataService.getJob(
        target.environment,
        target.selectedTarget.jobUrl
      );
      return {
        kind: "matched",
        branchName: target.branchName,
        link: target.link,
        environment: target.environment,
        resolvedTargetKind: target.selectedTarget.kind,
        jobName: target.selectedTarget.jobName,
        jobUrl: target.selectedTarget.jobUrl,
        jobColor: target.selectedTarget.jobColor,
        lastBuild: toLastBuildInfo(jobDetails.lastBuild),
        pullRequest: target.selectedTarget.pullRequest
      };
    } catch (error) {
      return {
        kind: "requestFailed",
        branchName: target.branchName,
        link: target.link,
        environment: target.environment,
        message: buildSelectedTargetHydrationErrorMessage(target.selectedTarget, error),
        selectedTarget: target.selectedTarget
      };
    }
  }
}

function toLastBuildInfo(
  lastBuild:
    | {
        url?: string;
        number?: number;
        result?: string;
        building?: boolean;
        timestamp?: number;
      }
    | undefined
): CurrentBranchBuildInfo | undefined {
  return lastBuild
    ? {
        url: lastBuild.url,
        number: lastBuild.number,
        result: lastBuild.result,
        building: lastBuild.building,
        timestamp: lastBuild.timestamp
      }
    : undefined;
}

function toResolutionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to resolve current branch.";
}

function buildSelectedTargetHydrationErrorMessage(
  target: CurrentBranchSelectedTargetInfo,
  error: unknown
): string {
  const detail = toResolutionErrorMessage(error);
  if (target.kind === "pullRequest" && target.pullRequest) {
    return `Unable to load Jenkins PR #${target.pullRequest.number}: ${detail}`;
  }

  return `Unable to load Jenkins branch job "${target.jobName}": ${detail}`;
}

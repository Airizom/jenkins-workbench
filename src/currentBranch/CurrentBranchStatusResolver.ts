import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { type CachedValue, getFreshCachedValue, setCachedValue } from "./CurrentBranchCache";
import { captureCheckout } from "./CurrentBranchCheckout";
import { assessCommit, CurrentBranchCommitHistory } from "./CurrentBranchCommitHistory";
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

const REMOTE_RESOLUTION_CACHE_TTL_MS = 5_000;

export class CurrentBranchStatusResolver {
  private readonly remoteStateCache = new Map<
    string,
    CachedValue<CurrentBranchRemoteResolvedState>
  >();
  private readonly latestRemoteRequest = new Map<string, number>();
  private requestId = 0;

  constructor(
    dataService: JenkinsDataService,
    private readonly targetResolver: CurrentBranchTargetResolver,
    private readonly commitHistory = new CurrentBranchCommitHistory(dataService)
  ) {}

  dispose(): void {
    this.remoteStateCache.clear();
    this.latestRemoteRequest.clear();
    this.targetResolver.dispose();
  }

  async resolve(
    context: CurrentBranchLinkedContext,
    options: CurrentBranchRefreshOptions
  ): Promise<CurrentBranchState> {
    const requestId = ++this.requestId;
    const localState = {
      ...context,
      checkout: context.checkout ?? captureCheckout(context.repository.repository)
    };
    try {
      const targetResolution = await this.targetResolver.resolve(localState, options);
      const cacheKey = targetResolution.cacheKey;
      if (!options.force) {
        const cachedState = getFreshCachedValue(this.remoteStateCache, cacheKey);
        if (cachedState) {
          return this.materializeRemoteState(localState, cachedState);
        }
      }

      this.latestRemoteRequest.set(
        cacheKey,
        Math.max(requestId, this.latestRemoteRequest.get(cacheKey) ?? 0)
      );
      const resolved =
        targetResolution.kind === "selected"
          ? await this.hydrateSelectedTarget(targetResolution.target)
          : {
              kind: "branchMissing" as const,
              branchName: targetResolution.branchName,
              link: targetResolution.link,
              environment: targetResolution.environment
            };
      if (this.latestRemoteRequest.get(cacheKey) === requestId) {
        setCachedValue(this.remoteStateCache, cacheKey, resolved, REMOTE_RESOLUTION_CACHE_TTL_MS);
      }
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
      ...(remoteState.kind === "matched" && remoteState.history && localState.checkout
        ? {
            checkout: localState.checkout,
            commit: assessCommit(remoteState.history, localState.checkout)
          }
        : {}),
      repository: toRepositoryInfo(localState.repository)
    };
  }

  private async hydrateSelectedTarget(
    target: CurrentBranchResolvedTarget
  ): Promise<CurrentBranchRemoteResolvedState> {
    try {
      const history = await this.commitHistory.load(
        target.environment,
        target.selectedTarget.jobUrl
      );
      const jobDetails = history.job;
      return {
        kind: "matched",
        history,
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

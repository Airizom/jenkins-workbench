import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { type CachedValue, resolveCachedLatest } from "./CurrentBranchCache";
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
      const resolved = await resolveCachedLatest(
        this.remoteStateCache,
        this.latestRemoteRequest,
        targetResolution.cacheKey,
        requestId,
        REMOTE_RESOLUTION_CACHE_TTL_MS,
        options.force,
        async (): Promise<CurrentBranchRemoteResolvedState> =>
          targetResolution.kind === "selected"
            ? this.hydrateSelectedTarget(targetResolution.target)
            : {
                kind: "branchMissing",
                branchName: targetResolution.branchName,
                link: targetResolution.link,
                environment: targetResolution.environment
              }
      );
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
  lastBuild: CurrentBranchBuildInfo | undefined
): CurrentBranchBuildInfo | undefined {
  if (!lastBuild) {
    return undefined;
  }
  const { url, number, result, building, timestamp } = lastBuild;
  return { url, number, result, building, timestamp };
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

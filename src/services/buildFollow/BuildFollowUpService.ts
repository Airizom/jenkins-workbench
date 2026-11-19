import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  formatJobUrlLabel,
  type JenkinsBuildUrlSource,
  normalizeJenkinsUrlForComparison,
  parseQueueItemId,
  resolveBuildIdentityForEnvironment
} from "../../jenkins/urls";
import { isBuildQueueId } from "../../shared/build/BuildCompletionEvidence";
import { withActionErrorMessage } from "../../ui/ActionErrorMessage";
import type { PollCancellationToken } from "../polling/Polling";
import type { QueuedBuildWaiter } from "../QueuedBuildWaiter";
import type {
  BuildCompletionTracker,
  QueueCancellationWatch,
  SubmittedQueueDiscovery
} from "./BuildCompletionTracker";
import type { RunStatus } from "./BuildFollowEntry";
import type {
  CauseTriggeredBuildOrigin,
  FollowedBuild,
  FollowedBuildActions,
  TriggerCauseKind,
  TriggeredBuildLocation,
  TriggeredBuildOrigin
} from "./BuildFollowTypes";
import type { SubmittedQueueObservations } from "./FollowedQueueBuild";
import { StartedBuildCompletionWatch } from "./StartedBuildCompletionWatch";

const VIEW_BUILD_DETAILS = "View Build Details";
const PREVIEW_LOG = "Preview Log";
const NOTIFY_WHEN_FINISHED = "Notify When Finished";

// Matches the tree refresh timing used before the follow-up existed.
const DEFAULT_REFRESH_FALLBACK_MS = 30_000;

export interface BuildFollowUpDependencies {
  dataService: Pick<JenkinsDataService, "getNextBuildNumber">;
  locator: {
    locate(
      origin: TriggeredBuildOrigin,
      token?: PollCancellationToken
    ): Promise<TriggeredBuildLocation>;
  };
  queuedBuildWaiter: Pick<QueuedBuildWaiter, "awaitQueuedBuildStart">;
  /** Resolved on first use, so the panel stack is not built at activation. */
  actions: FollowedBuildActions;
  completionTracker: Pick<
    BuildCompletionTracker,
    | "observeBuildIdentity"
    | "followStartedBuild"
    | "beginSubmittedQueueDiscovery"
    | "watchQueueCancellation"
    | "onDidNotifyCompletion"
  >;
  isEnabled: () => boolean;
  refreshFallbackMs?: number;
}

/** A submission that goes through the queue API and returns a queue item (Trigger Build). */
export interface QueueFollowRequest {
  kind: "queue";
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  /** Job label used in messages. */
  label: string;
}

/** A rebuild, replay, or restart of `sourceBuildUrl`, found by its cause when there's no queue item. */
export interface CauseFollowRequest {
  kind: "cause";
  environment: JenkinsEnvironmentRef;
  sourceBuildUrl: string;
  /** For an independently resolved source. Otherwise use the actual submission endpoint. */
  sourceUrlKind?: JenkinsBuildUrlSource;
  sourceBuildNumber?: number;
  cause: TriggerCauseKind;
  /** Job label for messages; derived from the build URL when omitted. */
  jobLabel?: string;
  stageName?: string;
  /** Jenkins may answer with a queue location (replay); without following, wait on it as before. */
  mayReturnQueueItem?: boolean;
}

/** An action submitted on the configured controller confirms that exact public endpoint. */
export function submittedUrlSource(
  environment: JenkinsEnvironmentRef,
  url: string
): JenkinsBuildUrlSource {
  return normalizeJenkinsUrlForComparison(url, environment.url).startsWith(
    normalizeJenkinsUrlForComparison(environment.url)
  )
    ? "configured"
    : "reported";
}

/** Resolve the source run before stripping its number, retaining proxy and project-child identity. */
export function resolveFollowSourceJob(
  environment: JenkinsEnvironmentRef,
  buildUrl: string,
  buildNumber?: number,
  source: JenkinsBuildUrlSource = submittedUrlSource(environment, buildUrl)
) {
  const run = resolveBuildIdentityForEnvironment(
    environment.url,
    buildUrl,
    "request",
    buildNumber === undefined ? undefined : { buildNumber },
    source
  );
  if (!run || (buildNumber !== undefined && run.buildNumber !== buildNumber)) return undefined;
  return { jobUrl: new URL("../", run.buildUrl).href, buildNumber: run.buildNumber };
}

export type FollowRequest = QueueFollowRequest | CauseFollowRequest;

/** The result of `prepare`, passed back to `announceAndFollow` after submitting. */
export interface PreparedFollow {
  readonly request: FollowRequest;
  readonly causeOrigin?: CauseTriggeredBuildOrigin;
}

export interface AnnounceAndFollowOptions {
  /** Queue or build location Jenkins returned for the submission, if any. */
  location?: string;
  /** For example "Rebuild requested for #12"; "Waiting for it to start…" is appended when following. */
  requestedMessage: string;
  /** Shown when the build won't be followed. Defaults to the requested message. */
  plainMessage?: string;
  /** Refreshes the tree once: when the build is located or after 30s, whichever comes first. */
  refresh: () => void;
  /** Runs after the new build is located (or the follow-up gives up). */
  onSettled?: () => Promise<unknown> | undefined;
}

/**
 * Shared follow-up for every flow that starts a new build. Callers `prepare` before submitting
 * (a rebuild, replay, or restart needs the job's next build number from before the submission),
 * then `announceAndFollow`, which shows the right message, waits for the build to start, and offers
 * to open it, tail its log, or notify when it finishes.
 */
export class BuildFollowUpService implements vscode.Disposable {
  /** In-flight follow-ups: each locate token with its fallback refresh timer. */
  private readonly pending = new Map<
    { isCancellationRequested: boolean },
    {
      refreshTimer: ReturnType<typeof setTimeout>;
      cancellationWatch?: QueueCancellationWatch;
      completionWatch: StartedBuildCompletionWatch;
    }
  >();

  private readonly submittedQueues = new Set<SubmittedQueueDiscovery>();

  constructor(private readonly deps: BuildFollowUpDependencies) {}

  /** Never rejects: when the next build number can't be read, the build is found by queue item or not at all. */
  async prepare(request: FollowRequest): Promise<PreparedFollow> {
    if (request.kind === "queue" || !this.deps.isEnabled()) {
      return { request };
    }
    const causeOrigin = await this.prepareCauseOrigin(request);
    return causeOrigin ? { request, causeOrigin } : { request };
  }

  /** Fire-and-forget after a successful submission. */
  announceAndFollow(prepared: PreparedFollow, options: AnnounceAndFollowOptions): void {
    const origin = this.resolveOrigin(prepared, options.location);
    const following = origin !== undefined && this.canFollow(origin);
    void vscode.window.showInformationMessage(
      following
        ? `${options.requestedMessage}. Waiting for it to start…`
        : (options.plainMessage ?? `${options.requestedMessage}.`)
    );
    const { request } = prepared;
    const label =
      origin?.label ??
      (request.kind === "queue" ? request.label : (request.jobLabel ?? request.sourceBuildUrl));
    const submittedJobUrl = origin?.kind === "queue" ? origin.jobUrl : undefined;
    const submission = this.beginQueueDiscovery(
      request,
      options.location,
      following,
      submittedJobUrl
    );
    if (submission) this.submittedQueues.add(submission);
    const finishDiscovery = (outcome?: TriggeredBuildLocation) => {
      if (submission && this.submittedQueues.delete(submission)) submission.finish(outcome);
    };
    if (origin?.kind === "queue" && submission?.observations)
      origin.observations = submission.observations;
    const run =
      following && origin
        ? this.follow(origin, options, finishDiscovery)
        : this.refreshWithoutFollowing(
            request,
            options,
            submittedJobUrl,
            finishDiscovery,
            submission?.observations
          );
    void run
      .catch((error) => {
        console.warn(`Failed to follow the triggered build for ${label}.`, error);
      })
      .finally(finishDiscovery);
  }

  private beginQueueDiscovery(
    request: FollowRequest,
    location: string | undefined,
    following: boolean,
    submittedJobUrl: string | undefined
  ) {
    const queueId = parseQueueItemId(location);
    if (
      queueId === undefined ||
      !(following || request.kind === "queue" || request.mayReturnQueueItem)
    )
      return undefined;
    return this.deps.completionTracker.beginSubmittedQueueDiscovery(
      request.environment,
      queueId,
      submittedJobUrl
    );
  }

  dispose(): void {
    for (const [token, { refreshTimer, cancellationWatch, completionWatch }] of this.pending) {
      clearTimeout(refreshTimer);
      token.isCancellationRequested = true;
      cancellationWatch?.dispose();
      completionWatch.dispose();
    }
    this.pending.clear();
    for (const submission of this.submittedQueues) submission.finish();
    this.submittedQueues.clear();
  }

  private canFollow(origin: TriggeredBuildOrigin): boolean {
    return (
      this.deps.isEnabled() &&
      (origin.kind === "cause" || parseQueueItemId(origin.queueLocation) !== undefined)
    );
  }

  private async prepareCauseOrigin(
    request: CauseFollowRequest
  ): Promise<CauseTriggeredBuildOrigin | undefined> {
    const { environment, sourceBuildUrl, cause } = request;
    const parsed = resolveFollowSourceJob(
      environment,
      sourceBuildUrl,
      request.sourceBuildNumber,
      request.sourceUrlKind
    );
    if (!parsed) {
      return undefined;
    }
    try {
      const firstCandidateNumber = await this.deps.dataService.getNextBuildNumber(
        environment,
        parsed.jobUrl
      );
      return {
        kind: "cause",
        environment,
        jobUrl: parsed.jobUrl,
        label: request.jobLabel ?? formatJobUrlLabel(parsed.jobUrl, environment.url),
        firstCandidateNumber,
        sourceBuildNumber: parsed.buildNumber,
        cause,
        ...(request.stageName ? { stageName: request.stageName } : {})
      };
    } catch (error) {
      console.warn(`Unable to read the next build number for ${sourceBuildUrl}.`, error);
      return undefined;
    }
  }

  /**
   * Follows the queue item when Jenkins returned one, otherwise the cause origin prepared
   * before submitting. Undefined when neither is available.
   */
  private resolveOrigin(
    prepared: PreparedFollow,
    location: string | undefined
  ): TriggeredBuildOrigin | undefined {
    const { request, causeOrigin } = prepared;
    if (request.kind === "queue") {
      return { ...request, queueLocation: location };
    }
    if (parseQueueItemId(location) === undefined) {
      return causeOrigin;
    }
    const { environment, sourceBuildUrl } = request;
    const jobUrl =
      causeOrigin?.jobUrl ??
      resolveFollowSourceJob(
        environment,
        sourceBuildUrl,
        request.sourceBuildNumber,
        request.sourceUrlKind
      )?.jobUrl;
    return {
      kind: "queue",
      environment,
      jobUrl,
      label:
        causeOrigin?.label ??
        request.jobLabel ??
        formatJobUrlLabel(jobUrl ?? sourceBuildUrl, environment.url),
      queueLocation: location
    };
  }

  /** The behaviour before the follow-up existed: wait on a queue item if there may be one, then refresh. */
  private async refreshWithoutFollowing(
    request: FollowRequest,
    options: AnnounceAndFollowOptions,
    submittedJobUrl: string | undefined,
    finishDiscovery: (outcome?: TriggeredBuildLocation) => void,
    observations?: SubmittedQueueObservations
  ): Promise<void> {
    try {
      if (request.kind === "queue" || request.mayReturnQueueItem) {
        const outcome = await this.deps.queuedBuildWaiter.awaitQueuedBuildStart(
          request.environment,
          options.location,
          submittedJobUrl,
          ...(observations ? [observations] : [])
        );
        if (outcome?.kind === "started") {
          const jobLabel =
            request.kind === "queue"
              ? request.label
              : (request.jobLabel ?? formatJobUrlLabel(outcome.url, request.environment.url));
          finishDiscovery({
            kind: "started",
            environment: request.environment,
            buildUrl: outcome.url,
            buildNumber: outcome.number,
            ...(outcome.fallbackUrl && { fallbackUrl: outcome.fallbackUrl }),
            label: `${jobLabel} #${outcome.number}`
          });
        } else finishDiscovery(outcome);
      }
    } finally {
      finishDiscovery();
      options.refresh();
      await options.onSettled?.();
    }
  }

  private async follow(
    origin: TriggeredBuildOrigin,
    options: AnnounceAndFollowOptions,
    finishDiscovery: (outcome?: TriggeredBuildLocation) => void
  ): Promise<void> {
    const refreshOnce = once(options.refresh);
    const refreshTimer = setTimeout(
      refreshOnce,
      this.deps.refreshFallbackMs ?? DEFAULT_REFRESH_FALLBACK_MS
    );
    const token = { isCancellationRequested: false };
    const queueId = origin.kind === "queue" ? parseQueueItemId(origin.queueLocation) : undefined;
    const cancellationWatch =
      queueId === undefined
        ? undefined
        : this.deps.completionTracker.watchQueueCancellation(origin.environment, queueId);
    const completionWatch = new StartedBuildCompletionWatch(
      this.deps.completionTracker.onDidNotifyCompletion,
      origin.environment,
      queueId
    );
    this.pending.set(token, { refreshTimer, cancellationWatch, completionWatch });
    let location: TriggeredBuildLocation = { kind: "unknown" };
    try {
      try {
        location = await this.deps.locator.locate(origin, token);
      } catch (error) {
        console.warn(`Failed to locate the triggered build for ${origin.label}.`, error);
      }
      clearTimeout(refreshTimer);
      if (location.kind !== "cancelled") cancellationWatch?.dispose();
      if (token.isCancellationRequested) return;
      if (origin.kind === "cause" && location.kind === "started" && location.causeObservation) {
        // The numbered URL read during cause discovery may already have an open completion action.
        this.deps.completionTracker.observeBuildIdentity(
          {
            ...location,
            observedUrl: location.buildUrl,
            requestOrder: location.causeObservation.requestOrder
          },
          location.causeObservation.building
        );
      }
      if (location.kind === "cancelled" && (!cancellationWatch || cancellationWatch.claim())) {
        void vscode.window.showInformationMessage(`${origin.label} was cancelled in the queue.`);
      }
      finishDiscovery(location);
      refreshOnce();
      await options.onSettled?.();
      if (token.isCancellationRequested) return;
      if (location.kind === "started") {
        await this.offerStartedBuild(origin, location, queueId, completionWatch, token);
      }
    } finally {
      this.pending.delete(token);
      cancellationWatch?.dispose();
      completionWatch.dispose();
    }
  }

  private async offerStartedBuild(
    origin: TriggeredBuildOrigin,
    location: Extract<TriggeredBuildLocation, { kind: "started" }>,
    queueId: number | undefined,
    completionWatch: StartedBuildCompletionWatch,
    token: PollCancellationToken
  ): Promise<void> {
    const build = {
      environment: location.environment,
      buildUrl: location.buildUrl,
      buildNumber: location.buildNumber,
      label: location.label
    };
    const source =
      origin.kind === "queue"
        ? "configured"
        : submittedUrlSource(origin.environment, origin.jobUrl);
    const id = queueId ?? location.queueId;
    const target = id === undefined ? build : { ...build, queueId: id };
    const status = location.causeObservation ?? location.queueStatus;
    completionWatch.identify(
      target,
      source,
      status?.building === true ? status.requestOrder : undefined
    );
    await this.offerActions(
      target,
      source,
      completionWatch,
      token,
      origin.kind === "queue"
        ? (location.observedRunQueueId ?? location.queueStatus?.queueId)
        : location.queueId,
      location.queueStatus?.building === false ? location.queueStatus : undefined
    );
  }

  private async offerActions(
    target: FollowedBuild,
    source: JenkinsBuildUrlSource,
    completions: StartedBuildCompletionWatch,
    token: PollCancellationToken,
    observedRunQueueId?: number,
    verifiedTerminal?: RunStatus
  ): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `${target.label} started.`,
      VIEW_BUILD_DETAILS,
      PREVIEW_LOG,
      NOTIFY_WHEN_FINISHED
    );
    if (token.isCancellationRequested) return;
    const actionTarget = isBuildQueueId(observedRunQueueId)
      ? { ...target, requireQueueId: true }
      : target;
    switch (choice) {
      case VIEW_BUILD_DETAILS:
        await withActionErrorMessage(`Unable to open build details for ${target.label}`, async () =>
          this.deps.actions.showBuildDetails(
            verifiedTerminal
              ? { ...actionTarget, completion: { result: verifiedTerminal.result } }
              : actionTarget
          )
        );
        return;
      case PREVIEW_LOG:
        await withActionErrorMessage(`Failed to preview logs for ${target.label}`, async () =>
          this.deps.actions.previewLog(actionTarget)
        );
        return;
      case NOTIFY_WHEN_FINISHED: {
        if (completions.notified) return;
        const outcome = await this.deps.completionTracker.followStartedBuild(
          verifiedTerminal ? { ...target, verifiedTerminal } : target,
          source,
          observedRunQueueId,
          completions.possibleCompletion
        );
        if (outcome === "already-following") {
          void vscode.window.showInformationMessage(`Already following ${target.label}.`);
        }
        return;
      }
      default:
        return;
    }
  }
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) {
      return;
    }
    called = true;
    callback();
  };
}

import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { parseBuildUrl, parseJobUrl, parseQueueItemId } from "../../jenkins/urls";
import { withActionErrorMessage } from "../../ui/ActionErrorMessage";
import type { PollCancellationToken } from "../polling/Polling";
import type { QueuedBuildWaiter } from "../QueuedBuildWaiter";
import type {
  CauseTriggeredBuildOrigin,
  FollowedBuild,
  FollowedBuildActions,
  TriggerCauseKind,
  TriggeredBuildLocation,
  TriggeredBuildOrigin
} from "./BuildFollowTypes";

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
  completionTracker: { follow(build: FollowedBuild): boolean };
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
  cause: TriggerCauseKind;
  /** Job label for messages; derived from the build URL when omitted. */
  jobLabel?: string;
  stageName?: string;
  /** Jenkins may answer with a queue location (replay); without following, wait on it as before. */
  mayReturnQueueItem?: boolean;
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
    ReturnType<typeof setTimeout>
  >();

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
    const run =
      following && origin
        ? this.follow(origin, options)
        : this.refreshWithoutFollowing(prepared.request, options);
    void run.catch((error) => {
      console.warn(`Failed to follow the triggered build for ${label}.`, error);
    });
  }

  dispose(): void {
    for (const [token, refreshTimer] of this.pending) {
      clearTimeout(refreshTimer);
      token.isCancellationRequested = true;
    }
    this.pending.clear();
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
    const parsed = parseBuildUrl(sourceBuildUrl, environment.url);
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
        label: request.jobLabel ?? formatJobLabel(parsed.jobUrl, environment.url),
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
      parseBuildUrl(sourceBuildUrl, environment.url)?.jobUrl ??
      sourceBuildUrl;
    return {
      kind: "queue",
      environment,
      jobUrl,
      label: causeOrigin?.label ?? request.jobLabel ?? formatJobLabel(jobUrl, environment.url),
      queueLocation: location
    };
  }

  /** The behaviour before the follow-up existed: wait on a queue item if there may be one, then refresh. */
  private async refreshWithoutFollowing(
    request: FollowRequest,
    options: AnnounceAndFollowOptions
  ): Promise<void> {
    try {
      if (request.kind === "queue" || request.mayReturnQueueItem) {
        await this.deps.queuedBuildWaiter.awaitQueuedBuildStart(
          request.environment,
          options.location
        );
      }
    } finally {
      options.refresh();
      await options.onSettled?.();
    }
  }

  private async follow(
    origin: TriggeredBuildOrigin,
    options: AnnounceAndFollowOptions
  ): Promise<void> {
    const refreshOnce = once(options.refresh);
    const refreshTimer = setTimeout(
      refreshOnce,
      this.deps.refreshFallbackMs ?? DEFAULT_REFRESH_FALLBACK_MS
    );
    const token = { isCancellationRequested: false };
    this.pending.set(token, refreshTimer);
    let location: TriggeredBuildLocation = { kind: "unknown" };
    try {
      location = await this.deps.locator.locate(origin, token);
    } catch (error) {
      console.warn(`Failed to locate the triggered build for ${origin.label}.`, error);
    } finally {
      this.pending.delete(token);
      clearTimeout(refreshTimer);
      if (!token.isCancellationRequested) {
        refreshOnce();
      }
    }
    if (token.isCancellationRequested) {
      return;
    }
    await options.onSettled?.();

    if (location.kind === "cancelled") {
      void vscode.window.showInformationMessage(`${origin.label} was cancelled in the queue.`);
      return;
    }
    if (location.kind === "started") {
      await this.offerActions({
        environment: location.environment,
        buildUrl: location.buildUrl,
        buildNumber: location.buildNumber,
        label: location.label
      });
    }
  }

  private async offerActions(build: FollowedBuild): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `${build.label} started.`,
      VIEW_BUILD_DETAILS,
      PREVIEW_LOG,
      NOTIFY_WHEN_FINISHED
    );
    switch (choice) {
      case VIEW_BUILD_DETAILS:
        await withActionErrorMessage(`Unable to open build details for ${build.label}`, async () =>
          this.deps.actions.showBuildDetails(build)
        );
        return;
      case PREVIEW_LOG:
        await withActionErrorMessage(`Failed to preview logs for ${build.label}`, async () =>
          this.deps.actions.previewLog(build)
        );
        return;
      case NOTIFY_WHEN_FINISHED:
        if (!this.deps.completionTracker.follow(build)) {
          void vscode.window.showInformationMessage(`Already following ${build.label}.`);
        }
        return;
      default:
        return;
    }
  }
}

function formatJobLabel(jobUrl: string, environmentUrl: string): string {
  return parseJobUrl(jobUrl, environmentUrl)?.fullPath.join("/") ?? jobUrl;
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

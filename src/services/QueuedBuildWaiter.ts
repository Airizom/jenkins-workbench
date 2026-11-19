import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { parseQueueItemId } from "../jenkins/urls";
import type { RunStatus } from "./buildFollow/BuildFollowEntry";
import {
  QueueItemEvidence,
  type QueueObservation,
  type SubmittedQueueObservations
} from "./buildFollow/FollowedQueueBuild";
import {
  createPollBackoff,
  delay,
  isClientError,
  type PollCancellationToken
} from "./polling/Polling";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FALLBACK_DELAY_MS = 4000;
const MAX_CONSECUTIVE_ERRORS = 3;

export type QueuedBuildOutcome =
  | {
      kind: "started";
      number: number;
      url: string;
      fallbackUrl?: string;
      queueStatus?: RunStatus;
      observedRunQueueId?: number;
    }
  | { kind: "cancelled" }
  | { kind: "unknown" };

export interface AwaitQueuedBuildOptions {
  timeoutMs: number;
  maxPollIntervalMs: number;
  token?: PollCancellationToken;
  /** The job whose successful submission returned this queue location. */
  submittedJobUrl?: string;
  observations?: SubmittedQueueObservations;
}

export class QueuedBuildWaiter {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fallbackDelayMs: number;

  constructor(
    private readonly dataService: Pick<JenkinsDataService, "getQueueItem">,
    options?: { pollIntervalMs?: number; timeoutMs?: number; fallbackDelayMs?: number }
  ) {
    this.pollIntervalMs = Math.max(200, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.timeoutMs = Math.max(1000, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.fallbackDelayMs = Math.max(0, options?.fallbackDelayMs ?? DEFAULT_FALLBACK_DELAY_MS);
  }

  async awaitQueuedBuildStart(
    environment: JenkinsEnvironmentRef,
    queueLocation?: string,
    submittedJobUrl?: string,
    observations?: SubmittedQueueObservations
  ): Promise<QueuedBuildOutcome | undefined> {
    if (!parseQueueItemId(queueLocation)) {
      if (this.fallbackDelayMs > 0) {
        await delay(this.fallbackDelayMs);
      }
      return;
    }
    return this.awaitQueuedBuild(environment, queueLocation, {
      timeoutMs: this.timeoutMs,
      maxPollIntervalMs: this.pollIntervalMs,
      submittedJobUrl,
      observations
    });
  }

  /**
   * Polls the queue item until it starts a build, is cancelled, or the wait gives up.
   * The interval starts at the configured poll interval and backs off up to `maxPollIntervalMs`.
   */
  async awaitQueuedBuild(
    environment: JenkinsEnvironmentRef,
    queueLocation: string | undefined,
    options: AwaitQueuedBuildOptions
  ): Promise<QueuedBuildOutcome> {
    const queueId = parseQueueItemId(queueLocation);
    if (!queueId) {
      return { kind: "unknown" };
    }

    const deadline = Date.now() + options.timeoutMs;
    const local = new QueueItemEvidence({ environment, queueId, label: "" });
    local.rememberSubmittedJob(options.submittedJobUrl);
    const shared = options.observations;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const shouldPoll = () =>
      active && Date.now() < deadline && !options.token?.isCancellationRequested;
    const poll = async (): Promise<QueueObservation> => {
      const backoff = createPollBackoff(this.pollIntervalMs, options.maxPollIntervalMs);
      let consecutiveErrors = 0;
      while (shouldPoll()) {
        try {
          const item = await this.dataService.getQueueItem(environment, queueId);
          if (!active || options.token?.isCancellationRequested) return;
          const outcome = (shared ?? local).observe(item);
          if (outcome?.kind === "unknown") return shared?.afterPendingReads();
          if (outcome) return outcome;
          consecutiveErrors = 0;
        } catch (error) {
          consecutiveErrors += 1;
          if (isClientError(error) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            return shared?.afterPendingReads();
          }
        }
        await delay(backoff.next());
      }
      return undefined;
    };
    try {
      const outcome = shared
        ? await Promise.race([
            poll(),
            shared.whenIdentified,
            new Promise<undefined>((resolve) => {
              timeout = setTimeout(() => resolve(undefined), options.timeoutMs);
            })
          ])
        : await poll();
      return outcome?.kind === "started"
        ? {
            kind: "started",
            number: outcome.build.buildNumber,
            url: outcome.build.buildUrl,
            ...(outcome.build.fallbackUrl && { fallbackUrl: outcome.build.fallbackUrl }),
            ...(outcome.build.queueStatus && { queueStatus: outcome.build.queueStatus }),
            ...(outcome.build.observedRunQueueId !== undefined && {
              observedRunQueueId: outcome.build.observedRunQueueId
            })
          }
        : (outcome ?? { kind: "unknown" });
    } finally {
      active = false;
      clearTimeout(timeout);
    }
  }
}

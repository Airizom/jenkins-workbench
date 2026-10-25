import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsQueueItem } from "../jenkins/types";
import { parseQueueItemId } from "../jenkins/urls";
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
  | { kind: "started"; number: number; url?: string }
  | { kind: "cancelled" }
  | { kind: "unknown" };

export interface AwaitQueuedBuildOptions {
  timeoutMs: number;
  maxPollIntervalMs: number;
  token?: PollCancellationToken;
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
    queueLocation?: string
  ): Promise<void> {
    if (!parseQueueItemId(queueLocation)) {
      if (this.fallbackDelayMs > 0) {
        await delay(this.fallbackDelayMs);
      }
      return;
    }
    await this.awaitQueuedBuild(environment, queueLocation, {
      timeoutMs: this.timeoutMs,
      maxPollIntervalMs: this.pollIntervalMs
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
    const backoff = createPollBackoff(this.pollIntervalMs, options.maxPollIntervalMs);
    let consecutiveErrors = 0;
    while (Date.now() < deadline && !options.token?.isCancellationRequested) {
      try {
        const item = await this.dataService.getQueueItem(environment, queueId);
        const outcome = resolveQueueItemOutcome(item);
        if (outcome) {
          return outcome;
        }
        consecutiveErrors = 0;
      } catch (error) {
        // A client error (item gone, auth) will not recover; retry others a few times.
        consecutiveErrors += 1;
        if (isClientError(error) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { kind: "unknown" };
        }
      }
      await delay(backoff.next());
    }
    return { kind: "unknown" };
  }
}

function resolveQueueItemOutcome(item: JenkinsQueueItem): QueuedBuildOutcome | undefined {
  if (item.cancelled) {
    return { kind: "cancelled" };
  }
  if (!item.executable) {
    return undefined;
  }
  const { number, url } = item.executable;
  return Number.isSafeInteger(number) && number > 0
    ? { kind: "started", number, url: url || undefined }
    : { kind: "unknown" };
}

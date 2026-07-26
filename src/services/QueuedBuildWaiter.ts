import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { parseQueueItemId } from "../jenkins/urls";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FALLBACK_DELAY_MS = 4000;

export class QueuedBuildWaiter {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fallbackDelayMs: number;

  constructor(
    private readonly dataService: JenkinsDataService,
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
    const queueId = parseQueueItemId(queueLocation);
    if (!queueId) {
      if (this.fallbackDelayMs > 0) {
        await delay(this.fallbackDelayMs);
      }
      return;
    }

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      try {
        const item = await this.dataService.getQueueItem(environment, queueId);
        if (item.cancelled) {
          return;
        }
        if (item.executable) {
          return;
        }
      } catch {
        return;
      }
      await delay(this.pollIntervalMs);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

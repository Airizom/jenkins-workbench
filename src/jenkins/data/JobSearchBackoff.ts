import { JenkinsRequestError } from "../JenkinsClient";
import type { CancellationInput } from "./JenkinsDataTypes";
import { waitWithCancellation } from "./JobSearchCancellation";

export const DEFAULT_BACKOFF_SUCCESS_DECAY = 0.5;
export const DEFAULT_BACKOFF_ERROR_MULTIPLIER = 2;
export const DEFAULT_BACKOFF_JITTER_RATIO = 0.2;

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT"
]);

export interface AdaptiveBackoffOptions {
  baseDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  successDecay: number;
  errorMultiplier: number;
  jitterRatio: number;
}

export class AdaptiveBackoff {
  private delayMs: number;

  constructor(private readonly options: AdaptiveBackoffOptions) {
    this.delayMs = Math.max(0, options.minDelayMs);
  }

  async wait(cancellation?: CancellationInput): Promise<void> {
    const delay = this.jitteredDelay();
    if (delay <= 0) {
      return;
    }
    await waitWithCancellation(delay, cancellation);
  }

  onSuccess(): void {
    if (this.delayMs <= this.options.minDelayMs) {
      this.delayMs = this.options.minDelayMs;
      return;
    }
    this.delayMs = Math.max(
      this.options.minDelayMs,
      Math.floor(this.delayMs * this.options.successDecay)
    );
  }

  onError(): void {
    const next =
      this.delayMs > 0 ? this.delayMs * this.options.errorMultiplier : this.options.baseDelayMs;
    this.delayMs = Math.min(
      this.options.maxDelayMs,
      Math.max(this.options.minDelayMs, Math.floor(next))
    );
  }

  private jitteredDelay(): number {
    if (this.delayMs <= 0 || this.options.jitterRatio <= 0) {
      return this.delayMs;
    }
    const jitter = this.delayMs * this.options.jitterRatio;
    const min = this.delayMs - jitter;
    const max = this.delayMs + jitter;
    return Math.max(this.options.minDelayMs, Math.floor(min + Math.random() * (max - min)));
  }
}

export const isRetryableError = (error: unknown): boolean => {
  if (error instanceof JenkinsRequestError) {
    if (error.statusCode === undefined) {
      return false;
    }
    return RETRYABLE_STATUS_CODES.has(error.statusCode);
  }

  if (error && typeof error === "object" && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    return Boolean(code && RETRYABLE_ERROR_CODES.has(code));
  }

  return false;
};

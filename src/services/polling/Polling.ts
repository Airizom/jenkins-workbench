import { JenkinsActionError, JenkinsRequestError } from "../../jenkins/errors";

const POLL_BACKOFF_FACTOR = 1.5;

/** Structural cancellation token, so pollers need neither vscode nor a feature module. */
export interface PollCancellationToken {
  readonly isCancellationRequested: boolean;
}

export interface PollBackoff {
  /** The delay to wait now; later calls grow ×1.5 up to the cap. */
  next(): number;
}

/** Returns successive poll delays: `initialMs`, then ×1.5 each time, capped at `maxMs`. */
export function createPollBackoff(initialMs: number, maxMs: number): PollBackoff {
  const cap = Math.max(initialMs, maxMs);
  let current = initialMs;
  return {
    next() {
      const value = current;
      current = Math.min(cap, Math.round(current * POLL_BACKOFF_FACTOR));
      return value;
    }
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A 4xx from Jenkins (item gone, auth) that retrying will not fix. */
export function isClientError(error: unknown): boolean {
  const statusCode = getJenkinsStatusCode(error) ?? 0;
  return statusCode >= 400 && statusCode < 500;
}

export function isNotFoundError(error: unknown): boolean {
  return getJenkinsStatusCode(error) === 404;
}

function getJenkinsStatusCode(error: unknown): number | undefined {
  return error instanceof JenkinsRequestError || error instanceof JenkinsActionError
    ? error.statusCode
    : undefined;
}

import type { CancellationInput, JobSearchOptions } from "./JenkinsDataTypes";

export const DEFAULT_JOB_SEARCH_MAX_RESULTS = Number.POSITIVE_INFINITY;
export const DEFAULT_JOB_SEARCH_BATCH_SIZE = 50;
export const DEFAULT_JOB_SEARCH_CONCURRENCY = 4;
export const DEFAULT_JOB_SEARCH_BACKOFF_BASE_MS = 200;
export const DEFAULT_JOB_SEARCH_BACKOFF_MAX_MS = 2000;
export const DEFAULT_JOB_SEARCH_MAX_RETRIES = 2;

export interface NormalizedJobSearchOptions {
  cancellation?: CancellationInput;
  maxResults: number;
  batchSize: number;
  concurrency: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  maxRetries: number;
}

export const normalizeJobSearchOptions = (
  options?: JobSearchOptions
): NormalizedJobSearchOptions => {
  const maxResults = resolveNonNegativeInt(options?.maxResults, DEFAULT_JOB_SEARCH_MAX_RESULTS);
  const batchSize = resolvePositiveInt(options?.batchSize, DEFAULT_JOB_SEARCH_BATCH_SIZE);
  const concurrency = resolvePositiveInt(options?.concurrency, DEFAULT_JOB_SEARCH_CONCURRENCY);
  const backoffBaseMs = resolveNonNegativeInt(
    options?.backoffBaseMs,
    DEFAULT_JOB_SEARCH_BACKOFF_BASE_MS
  );
  const backoffMaxMs = resolveNonNegativeInt(
    options?.backoffMaxMs,
    DEFAULT_JOB_SEARCH_BACKOFF_MAX_MS
  );
  const maxRetries = resolveNonNegativeInt(options?.maxRetries, DEFAULT_JOB_SEARCH_MAX_RETRIES);

  return {
    cancellation: options?.cancellation,
    maxResults,
    batchSize,
    concurrency,
    backoffBaseMs,
    backoffMaxMs: Math.max(backoffBaseMs, backoffMaxMs),
    maxRetries
  };
};

const resolvePositiveInt = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value as number));
};

const resolveNonNegativeInt = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value as number));
};

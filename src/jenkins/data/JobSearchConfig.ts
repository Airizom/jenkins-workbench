import type { CancellationInput, JobSearchOptions } from "./JenkinsDataTypes";

const DEFAULT_JOB_SEARCH_MAX_RESULTS = Number.POSITIVE_INFINITY;
const DEFAULT_JOB_SEARCH_BATCH_SIZE = 50;
const DEFAULT_JOB_SEARCH_CONCURRENCY = 4;
const MAX_JOB_SEARCH_CONCURRENCY = 10;
const DEFAULT_JOB_SEARCH_BACKOFF_BASE_MS = 200;
const DEFAULT_JOB_SEARCH_BACKOFF_MAX_MS = 2000;
const DEFAULT_JOB_SEARCH_MAX_RETRIES = 2;
const MAX_JOB_SEARCH_MAX_RETRIES = 10;

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
  const concurrency = resolveBoundedInt(
    options?.concurrency,
    DEFAULT_JOB_SEARCH_CONCURRENCY,
    1,
    MAX_JOB_SEARCH_CONCURRENCY
  );
  const backoffBaseMs = resolveNonNegativeInt(
    options?.backoffBaseMs,
    DEFAULT_JOB_SEARCH_BACKOFF_BASE_MS
  );
  const backoffMaxMs = resolveNonNegativeInt(
    options?.backoffMaxMs,
    DEFAULT_JOB_SEARCH_BACKOFF_MAX_MS
  );
  const maxRetries = resolveBoundedInt(
    options?.maxRetries,
    DEFAULT_JOB_SEARCH_MAX_RETRIES,
    0,
    MAX_JOB_SEARCH_MAX_RETRIES
  );

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

const resolveBoundedInt = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value as number)));
};

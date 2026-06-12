import type { JenkinsClientProvider } from "../JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { CancellationError } from "../errors";
import { AsyncQueue } from "./AsyncQueue";
import type { JenkinsDataCache } from "./JenkinsDataCache";
import type {
  CancellationInput,
  JenkinsJobInfo,
  JobPathSegment,
  JobSearchEntry,
  JobSearchOptions
} from "./JenkinsDataTypes";
import { mapJenkinsJobs } from "./JenkinsJobMapping";
import {
  AdaptiveBackoff,
  DEFAULT_BACKOFF_ERROR_MULTIPLIER,
  DEFAULT_BACKOFF_JITTER_RATIO,
  DEFAULT_BACKOFF_SUCCESS_DECAY,
  isRetryableError
} from "./JobSearchBackoff";
import { isCancellationRequested } from "./JobSearchCancellation";
import { normalizeJobSearchOptions } from "./JobSearchConfig";

interface JobIndexCacheEntry {
  timestamp: number;
  entries: JobSearchEntry[];
  complete: boolean;
}

interface JobSearchTraversalStrategy {
  cacheSegment: string;
  shouldInclude(job: JenkinsJobInfo): boolean;
  shouldTraverse(job: JenkinsJobInfo): boolean;
}

const JOB_INDEX_TTL_MS = 5 * 60 * 1000;

const FULL_JOB_SEARCH_STRATEGY: JobSearchTraversalStrategy = {
  cacheSegment: "job-index",
  shouldInclude: (job) => job.kind !== "folder" && job.kind !== "multibranch",
  shouldTraverse: (job) => job.kind === "folder" || job.kind === "multibranch"
};

const MULTIBRANCH_JOB_SEARCH_STRATEGY: JobSearchTraversalStrategy = {
  cacheSegment: "multibranch-index",
  shouldInclude: (job) => job.kind === "multibranch",
  shouldTraverse: (job) => job.kind === "folder"
};

interface JobQueueItem {
  job: JenkinsJobInfo;
  path: JobPathSegment[];
}

export class JenkinsJobIndex {
  constructor(
    private readonly cache: JenkinsDataCache,
    private readonly clientProvider: JenkinsClientProvider
  ) {}

  async getAllJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): Promise<JobSearchEntry[]> {
    const entries: JobSearchEntry[] = [];
    for await (const batch of this.iterateJobsForEnvironment(environment, options)) {
      entries.push(...batch);
    }
    return entries;
  }

  async getMultibranchJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): Promise<JobSearchEntry[]> {
    return this.getCachedOrCollectEntries(environment, options, MULTIBRANCH_JOB_SEARCH_STRATEGY);
  }

  async *iterateJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): AsyncIterable<JobSearchEntry[]> {
    for await (const batch of this.iterateSearchEntriesForEnvironment(
      environment,
      options,
      FULL_JOB_SEARCH_STRATEGY
    )) {
      yield batch;
    }
  }

  private async getCachedOrCollectEntries(
    environment: JenkinsEnvironmentRef,
    options: JobSearchOptions | undefined,
    strategy: JobSearchTraversalStrategy
  ): Promise<JobSearchEntry[]> {
    const entries: JobSearchEntry[] = [];
    for await (const batch of this.iterateSearchEntriesForEnvironment(
      environment,
      options,
      strategy
    )) {
      entries.push(...batch);
    }
    return entries;
  }

  private async *iterateSearchEntriesForEnvironment(
    environment: JenkinsEnvironmentRef,
    options: JobSearchOptions | undefined,
    strategy: JobSearchTraversalStrategy
  ): AsyncIterable<JobSearchEntry[]> {
    const authSignature = await this.clientProvider.getAuthSignature(environment);
    const cacheKey = this.cache.buildKey(
      environment,
      strategy.cacheSegment,
      undefined,
      authSignature
    );
    if (options?.mode !== "refresh") {
      const cached = this.cache.get<JobIndexCacheEntry | JobSearchEntry[]>(cacheKey);
      if (cached) {
        if (Array.isArray(cached)) {
          if (cached.length > 0) {
            yield cached;
          }
          return;
        }
        if (Date.now() - cached.timestamp < JOB_INDEX_TTL_MS) {
          const maxResults = options?.maxResults;
          if (cached.complete) {
            const entries = maxResults ? cached.entries.slice(0, maxResults) : cached.entries;
            if (entries.length > 0) {
              yield entries;
            }
            return;
          }
          if (maxResults && cached.entries.length >= maxResults) {
            yield cached.entries.slice(0, maxResults);
            return;
          }
        }
      }
    }

    const {
      cancellation,
      maxResults,
      batchSize,
      concurrency,
      backoffBaseMs,
      backoffMaxMs,
      maxRetries
    } = normalizeJobSearchOptions(options);

    const client = await this.clientProvider.getClient(environment);
    const output = new AsyncQueue<JobSearchEntry[]>();
    let disposed = false;
    let workQueue: AsyncQueue<JobQueueItem> | undefined;

    void (async () => {
      const throwIfStopped = (): void => {
        if (disposed) {
          throw new CancellationError();
        }
        this.throwIfCancelled(cancellation);
      };

      throwIfStopped();
      const backoff = new AdaptiveBackoff({
        baseDelayMs: backoffBaseMs,
        minDelayMs: 0,
        maxDelayMs: Math.max(backoffBaseMs, backoffMaxMs),
        successDecay: DEFAULT_BACKOFF_SUCCESS_DECAY,
        errorMultiplier: DEFAULT_BACKOFF_ERROR_MULTIPLIER,
        jitterRatio: DEFAULT_BACKOFF_JITTER_RATIO
      });

      const fetchWithRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
        let attempt = 0;
        for (;;) {
          throwIfStopped();
          await backoff.wait(cancellation);
          throwIfStopped();
          try {
            const result = await operation();
            throwIfStopped();
            backoff.onSuccess();
            return result;
          } catch (error) {
            if (!isRetryableError(error) || attempt >= maxRetries) {
              throw error;
            }
            attempt += 1;
            backoff.onError();
          }
        }
      };

      const rootJobs = await fetchWithRetry(() => client.getRootJobs());
      const rootInfos = mapJenkinsJobs(client, rootJobs);
      const queue = new AsyncQueue<JobQueueItem>();
      workQueue = queue;
      let pendingJobs = 0;
      let limitReached = false;

      const results: JobSearchEntry[] = [];
      let batch: JobSearchEntry[] = [];

      const flushBatch = async (): Promise<void> => {
        throwIfStopped();
        if (batch.length > 0) {
          output.push(batch);
          batch = [];
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          throwIfStopped();
        }
      };

      const markLimitReached = (): void => {
        if (limitReached) {
          return;
        }
        limitReached = true;
        const removed = queue.clear();
        pendingJobs -= removed;
        queue.close();
      };

      const enqueue = (job: JenkinsJobInfo, path: JobPathSegment[]): void => {
        if (limitReached || disposed) {
          return;
        }
        pendingJobs += 1;
        queue.push({ job, path });
      };

      const addEntry = async (job: JenkinsJobInfo, path: JobPathSegment[]): Promise<boolean> => {
        throwIfStopped();
        if (limitReached) {
          return true;
        }
        if (results.length >= maxResults) {
          markLimitReached();
          return true;
        }

        const entry = this.toSearchEntry(job, path);
        results.push(entry);
        batch.push(entry);
        if (batch.length >= batchSize) {
          await flushBatch();
        }
        if (results.length >= maxResults) {
          markLimitReached();
        }
        return limitReached;
      };

      for (const job of rootInfos) {
        if (strategy.shouldInclude(job) || strategy.shouldTraverse(job)) {
          enqueue(job, [this.toPathSegment(job)]);
        }
      }

      if (maxResults <= 0) {
        markLimitReached();
      }

      if (pendingJobs === 0) {
        await flushBatch();
        throwIfStopped();
        this.cache.set(cacheKey, {
          timestamp: Date.now(),
          entries: results,
          complete: !limitReached
        });
        output.close();
        return;
      }

      const worker = async (): Promise<void> => {
        for (;;) {
          throwIfStopped();
          const item = await queue.shift();
          if (!item) {
            return;
          }
          throwIfStopped();

          const { job, path } = item;

          try {
            if (limitReached) {
              continue;
            }

            if (strategy.shouldInclude(job) && (await addEntry(job, path))) {
              continue;
            }

            if (!strategy.shouldTraverse(job)) {
              continue;
            }

            const children = await fetchWithRetry(() => client.getFolderJobs(job.url));
            const childInfos = mapJenkinsJobs(client, children);
            for (const child of childInfos) {
              if (!strategy.shouldInclude(child) && !strategy.shouldTraverse(child)) {
                continue;
              }

              const childPath = [...path, this.toPathSegment(child)];
              enqueue(child, childPath);
            }
          } finally {
            pendingJobs -= 1;
            if (pendingJobs <= 0) {
              queue.close();
            }
          }
        }
      };

      let firstError: unknown;
      const workers = Array.from({ length: concurrency }, async () => {
        try {
          await worker();
        } catch (error) {
          firstError ??= error;
          queue.close();
        }
      });

      await Promise.all(workers);

      if (firstError) {
        if (firstError instanceof Error) {
          throw firstError;
        }
        throw new Error("Unexpected error.");
      }

      await flushBatch();
      throwIfStopped();
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        entries: results,
        complete: !limitReached
      });
      output.close();
    })().catch((error) => {
      output.fail(error);
    });

    try {
      for await (const batch of output) {
        yield batch;
      }
    } finally {
      disposed = true;
      output.clear();
      output.close();
      workQueue?.clear();
      workQueue?.close();
    }
  }

  private toPathSegment(job: JenkinsJobInfo): JobPathSegment {
    return {
      name: job.name,
      url: job.url,
      kind: job.kind
    };
  }

  private toSearchEntry(job: JenkinsJobInfo, path: JobPathSegment[]): JobSearchEntry {
    return {
      name: job.name,
      url: job.url,
      color: job.color,
      kind: job.kind,
      fullName: path.map((segment) => segment.name).join(" / "),
      path
    };
  }

  private throwIfCancelled(cancellation?: CancellationInput): void {
    if (isCancellationRequested(cancellation)) {
      throw new CancellationError();
    }
  }
}

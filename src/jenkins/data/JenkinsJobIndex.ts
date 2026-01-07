import type { JenkinsJob, JenkinsJobKind } from "../JenkinsClient";
import type { JenkinsClientProvider } from "../JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { AsyncQueue, JobQueue } from "./AsyncQueue";
import type { JenkinsDataCache } from "./JenkinsDataCache";
import { CancellationError } from "../errors";
import type {
  CancellationInput,
  JenkinsJobInfo,
  JobPathSegment,
  JobSearchEntry,
  JobSearchOptions
} from "./JenkinsDataTypes";
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

const JOB_INDEX_TTL_MS = 5 * 60 * 1000;
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

  async *iterateJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): AsyncIterable<JobSearchEntry[]> {
    const authSignature = await this.clientProvider.getAuthSignature(environment);
    const cacheKey = this.cache.buildKey(environment, "job-index", undefined, authSignature);
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

    void (async () => {
      this.throwIfCancelled(cancellation);
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
          this.throwIfCancelled(cancellation);
          await backoff.wait(cancellation);
          try {
            const result = await operation();
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
      const rootInfos = this.mapJobs(client, rootJobs);
      const queue = new JobQueue<JobQueueItem>();
      let pendingJobs = 0;
      let limitReached = false;

      const results: JobSearchEntry[] = [];
      let batch: JobSearchEntry[] = [];

      const flushBatch = (): void => {
        if (batch.length > 0) {
          output.push(batch);
          batch = [];
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
        if (limitReached) {
          return;
        }
        pendingJobs += 1;
        queue.push({ job, path });
      };

      const addEntry = (job: JenkinsJobInfo, path: JobPathSegment[]): boolean => {
        if (limitReached) {
          return true;
        }
        if (results.length >= maxResults) {
          markLimitReached();
          return true;
        }
        const entry: JobSearchEntry = {
          name: job.name,
          url: job.url,
          color: job.color,
          kind: job.kind,
          fullName: path.map((segment) => segment.name).join(" / "),
          path
        };
        results.push(entry);
        batch.push(entry);
        if (batch.length >= batchSize) {
          flushBatch();
        }
        if (results.length >= maxResults) {
          markLimitReached();
        }
        return limitReached;
      };

      for (const job of rootInfos) {
        enqueue(job, [this.toPathSegment(job)]);
      }

      if (maxResults <= 0) {
        markLimitReached();
      }

      if (pendingJobs === 0) {
        flushBatch();
        const complete = !limitReached;
        this.cache.set(cacheKey, {
          timestamp: Date.now(),
          entries: results,
          complete
        });
        output.close();
        return;
      }

      const worker = async (): Promise<void> => {
        for (;;) {
          this.throwIfCancelled(cancellation);
          const item = await queue.shift();
          if (!item) {
            return;
          }

          const { job, path } = item;

          try {
            if (limitReached) {
              continue;
            }

            if (job.kind !== "folder" && job.kind !== "multibranch") {
              addEntry(job, path);
              continue;
            }

            const children = await fetchWithRetry(() => client.getFolderJobs(job.url));
            const childInfos = this.mapJobs(client, children);
            for (const child of childInfos) {
              const childPath = [...path, this.toPathSegment(child)];
              if (child.kind === "folder" || child.kind === "multibranch") {
                enqueue(child, childPath);
              } else if (addEntry(child, childPath)) {
                break;
              }
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

      flushBatch();

      const complete = !limitReached;
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        entries: results,
        complete
      });

      output.close();
    })().catch((error) => {
      output.fail(error);
    });

    for await (const batch of output) {
      yield batch;
    }
  }

  private mapJobs(
    client: { classifyJob(job: JenkinsJob): JenkinsJobKind },
    jobs: JenkinsJob[]
  ): JenkinsJobInfo[] {
    return jobs.map((job) => ({
      name: job.name,
      url: job.url,
      color: job.color,
      kind: client.classifyJob(job)
    }));
  }

  private toPathSegment(job: JenkinsJobInfo): JobPathSegment {
    return {
      name: job.name,
      url: job.url,
      kind: job.kind
    };
  }

  private throwIfCancelled(cancellation?: CancellationInput): void {
    if (isCancellationRequested(cancellation)) {
      throw new CancellationError();
    }
  }
}

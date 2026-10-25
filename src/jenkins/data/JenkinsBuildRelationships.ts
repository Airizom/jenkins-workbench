import {
  type BuildRelationship,
  type DownstreamBuildSearchOptions,
  type DownstreamBuildSearchResult,
  extractUpstreamBuilds,
  resolveBuildRelationship,
  resolveRelationshipJobUrl
} from "../BuildRelationships";
import type { JenkinsClient } from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import type { JenkinsBuild, JenkinsJob } from "../types";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";

const MAX_REQUESTS = 100;
const CONCURRENCY = 4;
const DEADLINE_MS = 30_000;
const PAGE_SIZE = 100;

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value as number)))
    : fallback;
}

/** An on-demand, uncached scan. Every endpoint call shares one request/deadline budget. */
export class JenkinsBuildRelationships {
  constructor(private readonly context: Pick<JenkinsDataRuntimeContext, "getClient">) {}

  async getDownstreamBuilds(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options: DownstreamBuildSearchOptions = {}
  ): Promise<DownstreamBuildSearchResult> {
    const target = resolveBuildRelationship(environment.url, buildUrl);
    const matches = new Map<string, BuildRelationship>();
    const reasons = new Set<string>();
    let jobsSearched = 0;
    let buildsSearched = 0;
    let requestsMade = 0;
    let stopped = false;
    const snapshot = (): DownstreamBuildSearchResult => ({
      builds: [...matches.values()].sort(
        (left, right) => left.jobName.localeCompare(right.jobName) || right.number - left.number
      ),
      jobsSearched,
      buildsSearched,
      requestsMade,
      partialReasons: [...reasons],
      checkedAt: Date.now()
    });
    if (!target) {
      reasons.add("The current build URL is invalid for this Jenkins environment.");
      return snapshot();
    }
    if (options.signal?.aborted) {
      reasons.add("Search cancelled.");
      return snapshot();
    }
    const maxJobs = boundedLimit(options.maxJobs, 50, 200);
    const maxBuilds = boundedLimit(options.maxBuildsPerJob, 100, 1_000);
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const transportAbort = new AbortController();
    const stop = (reason: string): void => {
      if (!stopped) {
        stopped = true;
        reasons.add(reason);
        transportAbort.abort();
        finish();
      }
    };
    const abort = (): void => stop("Search cancelled.");
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => stop("The 30-second search deadline was reached."),
      DEADLINE_MS
    );
    const request = async <T>(
      action: (beforeRequest: () => void, signal: AbortSignal) => Promise<T>,
      description: string
    ): Promise<T | undefined> => {
      if (stopped) {
        return undefined;
      }
      if (requestsMade >= MAX_REQUESTS) {
        reasons.add("The 100-request search limit was reached.");
        return undefined;
      }
      try {
        const result = await action(() => {
          if (stopped) {
            throw new Error("Search stopped.");
          }
          if (requestsMade >= MAX_REQUESTS) {
            reasons.add("The 100-request search limit was reached.");
            throw new Error("Search request budget exhausted.");
          }
          requestsMade++;
        }, transportAbort.signal);
        return stopped ? undefined : result;
      } catch {
        if (!stopped) {
          reasons.add(`Unable to read ${description}; results may be incomplete.`);
        }
        return undefined;
      }
    };
    const scan = async (): Promise<void> => {
      const client = await this.context.getClient(environment);
      if (stopped) {
        return;
      }
      const candidates = new Map<string, string>();
      const folders: string[] = [];
      const visitedFolders = new Set<string>();
      const addJob = (job: JenkinsJob): void => {
        if (!job || typeof job !== "object") {
          return;
        }
        const resolved = resolveRelationshipJobUrl(environment.url, job.url);
        if (!resolved) {
          return;
        }
        if (job._class !== undefined && typeof job._class !== "string") {
          return;
        }
        const kind = client.classifyJob(job);
        if (kind === "folder" || kind === "multibranch") {
          if (!visitedFolders.has(resolved.jobUrl)) {
            visitedFolders.add(resolved.jobUrl);
            folders.push(resolved.jobUrl);
          }
        } else if (!candidates.has(resolved.jobUrl)) {
          if (candidates.size < maxJobs) {
            candidates.set(resolved.jobUrl, resolved.jobName);
          } else {
            reasons.add(`The ${maxJobs}-job search limit was reached.`);
          }
        }
      };
      const scanned = new Set<string>();
      const scanCandidates = async (): Promise<void> => {
        const pending = [...candidates.entries()].filter(([url]) => !scanned.has(url));
        const worker = async (): Promise<void> => {
          for (;;) {
            if (stopped || requestsMade >= MAX_REQUESTS) {
              if (pending.length > 0 && !stopped) {
                reasons.add("The 100-request search limit was reached.");
              }
              return;
            }
            const job = pending.shift();
            if (!job) {
              return;
            }
            scanned.add(job[0]);
            jobsSearched++;
            await this.scanJob(
              client,
              job[0],
              maxBuilds,
              request,
              () => stopped,
              (build) => {
                buildsSearched++;
                if (
                  extractUpstreamBuilds(environment.url, build).some(
                    (upstream) => upstream.buildUrl === target.buildUrl
                  )
                ) {
                  const relationship = resolveBuildRelationship(environment.url, build.url);
                  if (
                    relationship &&
                    relationship.jobUrl === job[0] &&
                    relationship.number === build.number
                  ) {
                    matches.set(relationship.buildUrl, {
                      ...relationship,
                      result: typeof build.result === "string" ? build.result : undefined,
                      building: typeof build.building === "boolean" ? build.building : undefined,
                      timestamp:
                        typeof build.timestamp === "number" && Number.isFinite(build.timestamp)
                          ? build.timestamp
                          : undefined
                    });
                  }
                }
              },
              () => reasons.add(`The ${maxBuilds}-build history limit was reached for ${job[1]}.`)
            );
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      };
      const configured = await request(
        (beforeRequest, signal) =>
          client.getDownstreamProjects(target.jobUrl, maxJobs + 1, beforeRequest, signal),
        "configured downstream projects"
      );
      if (configured && configured.length >= maxJobs + 1) {
        reasons.add("The configured downstream project list was truncated.");
      }
      configured?.forEach(addJob);
      // Inspect known children before unrelated folder enumeration can consume the deadline.
      await scanCandidates();
      if (stopped) {
        return;
      }
      if (candidates.size < maxJobs) {
        const root = await request(
          (beforeRequest, signal) =>
            client.getRelationshipJobs(environment.url, maxJobs + 1, beforeRequest, signal),
          "the root job list"
        );
        if (root && root.length >= maxJobs + 1) {
          reasons.add("The root job list was truncated.");
        }
        root?.forEach(addJob);
      } else {
        reasons.add(`The ${maxJobs}-job search limit was reached.`);
      }
      // Reserve approximately half of the total request budget for inspecting builds. A controller
      // containing many empty folders must not consume the whole scan on enumeration.
      while (!stopped && folders.length > 0 && candidates.size < maxJobs && requestsMade < 50) {
        const batch = folders.splice(0, Math.min(CONCURRENCY, 50 - requestsMade));
        const children = await Promise.all(
          batch.map((url) =>
            request(
              (beforeRequest, signal) =>
                client.getRelationshipJobs(url, maxJobs + 1, beforeRequest, signal),
              `jobs in ${url}`
            )
          )
        );
        children.forEach((jobs) => {
          if (jobs && jobs.length >= maxJobs + 1) {
            reasons.add("A folder job list was truncated.");
          }
          jobs?.forEach(addJob);
        });
      }
      if (folders.length > 0) {
        reasons.add(
          candidates.size >= maxJobs
            ? `The ${maxJobs}-job search limit was reached.`
            : "Job enumeration was limited to preserve the build-search request budget."
        );
      }
      await scanCandidates();
    };
    void scan()
      .catch(() => {
        if (!stopped) {
          reasons.add("Unable to start the downstream search; check the Jenkins connection.");
        }
      })
      .finally(finish);
    await completion;
    stopped = true;
    transportAbort.abort();
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    return snapshot();
  }

  private async scanJob(
    client: JenkinsClient,
    jobUrl: string,
    maxBuilds: number,
    request: <T>(
      action: (beforeRequest: () => void, signal: AbortSignal) => Promise<T>,
      description: string
    ) => Promise<T | undefined>,
    stopped: () => boolean,
    visit: (build: JenkinsBuild) => void,
    onLimit: () => void
  ): Promise<void> {
    for (let offset = 0; offset < maxBuilds && !stopped(); offset += PAGE_SIZE) {
      const limit = Math.min(PAGE_SIZE, maxBuilds - offset);
      const builds = await request(
        (beforeRequest, signal) =>
          client.getRelationshipBuilds(jobUrl, offset, limit, beforeRequest, signal),
        `build history for ${jobUrl}`
      );
      if (!builds || stopped()) {
        return;
      }
      for (const build of builds.slice(0, limit)) {
        if (build && typeof build === "object") {
          visit(build);
        }
      }
      if (builds.length < limit) {
        return;
      }
      if (offset + limit >= maxBuilds) {
        onLimit();
      }
    }
  }
}

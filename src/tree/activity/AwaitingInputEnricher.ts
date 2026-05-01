import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JobSearchEntry
} from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";

export interface AwaitingInputEnrichmentOptions {
  buildListFetchOptions: BuildListFetchOptions;
  buildLookupLimit: number;
  bypassCache?: boolean;
  lookupConcurrency: number;
}

export class AwaitingInputEnricher {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator
  ) {}

  async findAwaitingInputJobUrls(
    environment: JenkinsEnvironmentRef,
    runningCandidates: JobSearchEntry[],
    options: AwaitingInputEnrichmentOptions
  ): Promise<Set<string>> {
    const buildUrlsByJobUrl = await this.collectRunningBuildUrlsByJob(
      environment,
      runningCandidates,
      options
    );
    if (buildUrlsByJobUrl.size === 0) {
      return new Set();
    }
    const buildUrls = [...new Set([...buildUrlsByJobUrl.values()].flat())];

    let summaries: Awaited<ReturnType<PendingInputRefreshCoordinator["getSummaries"]>>;
    try {
      summaries = await this.pendingInputCoordinator.getSummaries(environment, buildUrls, {
        queueRefresh: true
      });
    } catch {
      return new Set();
    }

    const awaitingJobUrls = new Set<string>();
    for (const [jobUrl, candidateBuildUrls] of buildUrlsByJobUrl) {
      if (candidateBuildUrls.some((buildUrl) => summaries.get(buildUrl)?.awaitingInput)) {
        awaitingJobUrls.add(jobUrl);
      }
    }
    return awaitingJobUrls;
  }

  private async collectRunningBuildUrlsByJob(
    environment: JenkinsEnvironmentRef,
    runningCandidates: JobSearchEntry[],
    options: AwaitingInputEnrichmentOptions
  ): Promise<Map<string, string[]>> {
    const buildUrlsByJobUrl = new Map<string, string[]>();
    await runWithConcurrency(runningCandidates, options.lookupConcurrency, async (entry) => {
      try {
        const builds = await this.dataService.getBuildsForJob(
          environment,
          entry.url,
          options.buildLookupLimit,
          {
            ...options.buildListFetchOptions,
            // Build-list cache keys are not limit-aware; Activity uses a small lookup limit.
            bypassCache: true
          }
        );
        const runningBuildUrls = builds
          .filter((build) => Boolean(build.building) && build.url)
          .map((build) => build.url)
          .filter((url): url is string => Boolean(url));
        if (runningBuildUrls.length > 0) {
          buildUrlsByJobUrl.set(entry.url, runningBuildUrls);
        }
      } catch {
        // Activity should still load if one running job cannot be enriched.
      }
    });
    return buildUrlsByJobUrl;
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const current = index;
        index += 1;
        if (current >= items.length) {
          return;
        }
        const item = items[current];
        await operation(item);
      }
    })
  );
}

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

type PendingInputSummaries = Awaited<ReturnType<PendingInputRefreshCoordinator["getSummaries"]>>;

interface TreeActivityPendingInputEnrichmentSurface {
  findAwaitingInputJobUrls(
    environment: JenkinsEnvironmentRef,
    runningCandidates: JobSearchEntry[],
    options: AwaitingInputEnrichmentOptions
  ): Promise<Set<string>>;
}

export class AwaitingInputEnricher implements TreeActivityPendingInputEnrichmentSurface {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator
  ) {}

  async findAwaitingInputJobUrls(
    environment: JenkinsEnvironmentRef,
    runningCandidates: JobSearchEntry[],
    options: AwaitingInputEnrichmentOptions
  ): Promise<Set<string>> {
    if (runningCandidates.length === 0) {
      return new Set();
    }

    const buildUrlsByJobUrl = await this.collectRunningBuildUrlsByJob(
      environment,
      runningCandidates,
      options
    );
    if (buildUrlsByJobUrl.size === 0) {
      return new Set();
    }

    const summaries = await this.fetchPendingInputSummaries(
      environment,
      collectUniqueBuildUrls(buildUrlsByJobUrl)
    );
    if (!summaries) {
      return new Set();
    }

    return selectJobUrlsAwaitingInput(buildUrlsByJobUrl, summaries);
  }

  private async fetchPendingInputSummaries(
    environment: JenkinsEnvironmentRef,
    buildUrls: string[]
  ): Promise<PendingInputSummaries | undefined> {
    try {
      return await this.pendingInputCoordinator.getSummaries(environment, buildUrls, {
        queueRefresh: true
      });
    } catch {
      return undefined;
    }
  }

  private async collectRunningBuildUrlsByJob(
    environment: JenkinsEnvironmentRef,
    runningCandidates: JobSearchEntry[],
    options: AwaitingInputEnrichmentOptions
  ): Promise<Map<string, string[]>> {
    const buildUrlsByJobUrl = new Map<string, string[]>();
    const buildListFetchOptions = {
      ...options.buildListFetchOptions,
      // Pending-input checks need fresh build state, not TTL-cached lists.
      bypassCache: true
    };
    await runWithConcurrency(runningCandidates, options.lookupConcurrency, async (entry) => {
      try {
        const builds = await this.dataService.getBuildsForJob(
          environment,
          entry.url,
          options.buildLookupLimit,
          buildListFetchOptions
        );
        const runningBuildUrls: string[] = [];
        for (const build of builds) {
          if (build.building && build.url) {
            runningBuildUrls.push(build.url);
          }
        }
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

function collectUniqueBuildUrls(buildUrlsByJobUrl: ReadonlyMap<string, string[]>): string[] {
  const buildUrls: string[] = [];
  const seenBuildUrls = new Set<string>();
  for (const candidateBuildUrls of buildUrlsByJobUrl.values()) {
    for (const buildUrl of candidateBuildUrls) {
      if (!seenBuildUrls.has(buildUrl)) {
        seenBuildUrls.add(buildUrl);
        buildUrls.push(buildUrl);
      }
    }
  }
  return buildUrls;
}

function selectJobUrlsAwaitingInput(
  buildUrlsByJobUrl: ReadonlyMap<string, string[]>,
  summaries: PendingInputSummaries
): Set<string> {
  const awaitingJobUrls = new Set<string>();
  for (const [jobUrl, candidateBuildUrls] of buildUrlsByJobUrl) {
    if (candidateBuildUrls.some((buildUrl) => summaries.get(buildUrl)?.awaitingInput)) {
      awaitingJobUrls.add(jobUrl);
    }
  }
  return awaitingJobUrls;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let index = 0;
  const workerCount = Math.trunc(Math.min(Math.max(1, concurrency), items.length));
  const workers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const current = index;
          index += 1;
          if (current >= items.length) {
            return;
          }
          const item = items[current];
          await operation(item);
        }
      })()
    );
  }
  await Promise.all(workers);
}

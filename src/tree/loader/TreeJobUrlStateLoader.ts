import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { canonicalizeJobUrlForEnvironment } from "../../jenkins/urls";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";

type PinnedJobUrlEntry = {
  readonly jobUrl: string;
};

export class TreeJobUrlStateLoader {
  constructor(
    private readonly cacheManager: TreeChildrenCacheManager,
    private readonly watchStore: JenkinsWatchStore,
    private readonly pinStore: JenkinsPinStore
  ) {}

  async getWatchedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    const cached = this.cacheManager.getCachedWatchedJobs(environment);
    if (cached) {
      return cached;
    }

    const watched = await this.watchStore.getWatchedJobUrls(
      environment.scope,
      environment.environmentId
    );
    this.cacheManager.setCachedWatchedJobs(environment, watched);
    return watched;
  }

  async getPinnedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    const cached = this.cacheManager.getCachedPinnedJobs(environment);
    if (cached) {
      return cached;
    }

    const pinnedEntries = await this.pinStore.listPinnedJobsForEnvironment(
      environment.scope,
      environment.environmentId
    );
    const pinned = this.buildPinnedJobUrlSet(environment, pinnedEntries);
    this.cacheManager.setCachedPinnedJobs(environment, pinned);
    return pinned;
  }

  getPinnedJobUrlsFromEntries(
    environment: JenkinsEnvironmentRef,
    pinnedEntries: readonly PinnedJobUrlEntry[]
  ): Set<string> {
    const pinned = this.buildPinnedJobUrlSet(environment, pinnedEntries);
    this.cacheManager.setCachedPinnedJobs(environment, pinned);
    return pinned;
  }

  private buildPinnedJobUrlSet(
    environment: JenkinsEnvironmentRef,
    pinnedEntries: readonly PinnedJobUrlEntry[]
  ): Set<string> {
    const pinned = new Set<string>();
    for (const entry of pinnedEntries) {
      pinned.add(getCanonicalPinnedJobUrl(environment, entry.jobUrl));
    }
    return pinned;
  }
}

export function getCanonicalPinnedJobUrl(
  environment: JenkinsEnvironmentRef,
  jobUrl: string
): string {
  return canonicalizeJobUrlForEnvironment(environment.url, jobUrl) ?? jobUrl;
}

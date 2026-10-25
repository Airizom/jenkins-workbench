import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { canonicalizeJobUrlForEnvironment } from "../../jenkins/urls";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";

type PinnedJobUrlEntry = {
  readonly jobUrl: string;
};

export type JobUrlState = readonly [watchedJobs: Set<string>, pinnedJobs: Set<string>];

export class TreeJobUrlStateLoader {
  constructor(
    private readonly cacheManager: TreeChildrenCacheManager,
    private readonly watchStore: JenkinsWatchStore,
    private readonly pinStore: JenkinsPinStore
  ) {}

  async getJobUrlState(environment: JenkinsEnvironmentRef): Promise<JobUrlState> {
    return Promise.all([this.getWatchedJobUrls(environment), this.getPinnedJobUrls(environment)]);
  }

  getWatchedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    return this.cacheManager.watchedJobUrls.getOrLoad(environment, () =>
      this.watchStore.getWatchedJobUrls(environment.scope, environment.environmentId)
    );
  }

  getPinnedJobUrls(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    return this.cacheManager.pinnedJobUrls.getOrLoad(environment, async () => {
      const pinnedEntries = await this.pinStore.listPinnedJobsForEnvironment(
        environment.scope,
        environment.environmentId
      );
      return this.buildPinnedJobUrlSet(environment, pinnedEntries);
    });
  }

  getPinnedJobUrlsFromEntries(
    environment: JenkinsEnvironmentRef,
    pinnedEntries: readonly PinnedJobUrlEntry[]
  ): Set<string> {
    const pinned = this.buildPinnedJobUrlSet(environment, pinnedEntries);
    this.cacheManager.pinnedJobUrls.set(environment, pinned);
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

import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../coverage/JenkinsCoverageTypes";
import type { JenkinsClient } from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import type { JenkinsDataCache } from "./JenkinsDataCache";
import { toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";

const DEFAULT_COVERAGE_ACTION_PATH = "coverage";

export interface JenkinsCoverageRequestOptions {
  buildCompleted?: boolean;
  actionPath?: string;
}

export class JenkinsCoverageDataOperations {
  constructor(private readonly runtimeContext: JenkinsDataRuntimeContext) {}

  async getCoverageOverview(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<JenkinsCoverageOverview | undefined> {
    const actionPath = normalizeCoverageActionPath(options?.actionPath);
    return this.loadCoverageData(
      environment,
      "coverage-overview",
      buildUrl,
      actionPath,
      options?.buildCompleted,
      (client) => client.getCoverageOverview(buildUrl, actionPath)
    );
  }

  async getModifiedCoverageFiles(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<JenkinsModifiedCoverageFile[] | undefined> {
    const actionPath = normalizeCoverageActionPath(options?.actionPath);
    return this.loadCoverageData(
      environment,
      "coverage-modified",
      buildUrl,
      actionPath,
      options?.buildCompleted,
      (client) => client.getModifiedCoverageFiles(buildUrl, actionPath)
    );
  }

  async discoverCoverageActionPath(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<string | undefined> {
    return this.loadCoverageData(
      environment,
      "coverage-action-path",
      buildUrl,
      "",
      options?.buildCompleted,
      (client) => client.discoverCoverageActionPath(buildUrl)
    );
  }

  private async loadCoverageData<T>(
    environment: JenkinsEnvironmentRef,
    cacheKind: string,
    buildUrl: string,
    actionPath: string,
    buildCompleted: boolean | undefined,
    operation: (client: JenkinsClient) => Promise<T | undefined>
  ): Promise<T | undefined> {
    const completed = Boolean(buildCompleted);
    const cacheKey = await this.buildCacheKey(environment, cacheKind, buildUrl, actionPath);
    const cached = this.getCompletedBuildCacheEntry<T>(cacheKey, completed);
    if (cached !== undefined) {
      return cached;
    }

    return this.runtimeContext.getCache().withWriteGuard([cacheKey], async (cache) => {
      const client = await this.runtimeContext.getClient(environment);
      try {
        const value = await operation(client);
        this.updateCompletedBuildCache(cache, cacheKey, value, completed);
        return value;
      } catch (error) {
        throw toBuildActionError(error);
      }
    });
  }

  private getCompletedBuildCacheEntry<T>(cacheKey: string, buildCompleted: boolean): T | undefined {
    const cache = this.runtimeContext.getCache();
    if (buildCompleted) {
      const cached = cache.get<T>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    } else {
      cache.delete(cacheKey);
    }
    return undefined;
  }

  private updateCompletedBuildCache<T>(
    cache: Pick<JenkinsDataCache, "set" | "delete">,
    cacheKey: string,
    value: T | undefined,
    buildCompleted: boolean
  ): void {
    if (!buildCompleted) {
      return;
    }

    if (value !== undefined) {
      cache.set(cacheKey, value, this.runtimeContext.getCacheTtlMs());
    } else {
      cache.delete(cacheKey);
    }
  }

  private async buildCacheKey(
    environment: JenkinsEnvironmentRef,
    kind: string,
    buildUrl: string,
    actionPath: string
  ): Promise<string> {
    return this.runtimeContext.buildCacheKey(environment, kind, `${buildUrl}::${actionPath}`);
  }
}

function normalizeCoverageActionPath(actionPath?: string): string {
  const normalized = actionPath?.trim().replace(/^\/+|\/+$/g, "");
  return normalized || DEFAULT_COVERAGE_ACTION_PATH;
}

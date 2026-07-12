import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../coverage/JenkinsCoverageTypes";
import { toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";

const DEFAULT_COVERAGE_ACTION_PATH = "coverage";
const FORWARD_SLASH_CHAR_CODE = 47;

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
    const buildCompleted = Boolean(options?.buildCompleted);
    const actionPath = normalizeCoverageActionPath(options?.actionPath);
    const cacheKey = await this.buildCacheKey(
      environment,
      "coverage-overview",
      buildUrl,
      actionPath
    );
    const cached = this.getCompletedBuildCacheEntry<JenkinsCoverageOverview>(
      cacheKey,
      buildCompleted
    );
    if (cached !== undefined) {
      return cached;
    }

    const client = await this.runtimeContext.getClient(environment);
    try {
      const overview = await client.getCoverageOverview(buildUrl, actionPath);
      this.updateCompletedBuildCache(cacheKey, overview, buildCompleted);
      return overview;
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getModifiedCoverageFiles(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<JenkinsModifiedCoverageFile[] | undefined> {
    const buildCompleted = Boolean(options?.buildCompleted);
    const actionPath = normalizeCoverageActionPath(options?.actionPath);
    const cacheKey = await this.buildCacheKey(
      environment,
      "coverage-modified",
      buildUrl,
      actionPath
    );
    const cached = this.getCompletedBuildCacheEntry<JenkinsModifiedCoverageFile[]>(
      cacheKey,
      buildCompleted
    );
    if (cached !== undefined) {
      return cached;
    }

    const client = await this.runtimeContext.getClient(environment);
    try {
      const files = await client.getModifiedCoverageFiles(buildUrl, actionPath);
      this.updateCompletedBuildCache(cacheKey, files, buildCompleted);
      return files;
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async discoverCoverageActionPath(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<string | undefined> {
    const buildCompleted = Boolean(options?.buildCompleted);
    const cacheKey = await this.buildCacheKey(environment, "coverage-action-path", buildUrl, "");
    const cached = this.getCompletedBuildCacheEntry<string>(cacheKey, buildCompleted);
    if (cached !== undefined) {
      return cached;
    }

    const client = await this.runtimeContext.getClient(environment);
    try {
      const actionPath = await client.discoverCoverageActionPath(buildUrl);
      this.updateCompletedBuildCache(cacheKey, actionPath, buildCompleted);
      return actionPath;
    } catch (error) {
      throw toBuildActionError(error);
    }
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
    cacheKey: string,
    value: T | undefined,
    buildCompleted: boolean
  ): void {
    if (!buildCompleted) {
      return;
    }

    const cache = this.runtimeContext.getCache();
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
  const trimmed = actionPath?.trim();
  if (!trimmed) {
    return DEFAULT_COVERAGE_ACTION_PATH;
  }

  let start = 0;
  let end = trimmed.length;
  while (start < end && trimmed.charCodeAt(start) === FORWARD_SLASH_CHAR_CODE) {
    start += 1;
  }
  while (end > start && trimmed.charCodeAt(end - 1) === FORWARD_SLASH_CHAR_CODE) {
    end -= 1;
  }

  if (start === end) {
    return DEFAULT_COVERAGE_ACTION_PATH;
  }
  return start === 0 && end === trimmed.length ? trimmed : trimmed.slice(start, end);
}

import type { JenkinsClientProvider } from "../JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { JenkinsDataCache } from "../data/JenkinsDataCache";
import { toBuildActionError } from "../data/JenkinsDataErrors";
import { JenkinsCoverageApi } from "./JenkinsCoverageApi";
import type { JenkinsCoverageOverview, JenkinsModifiedCoverageFile } from "./JenkinsCoverageTypes";

export interface JenkinsCoverageServiceOptions {
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

export interface JenkinsCoverageRequestOptions {
  buildCompleted?: boolean;
  actionPath?: string;
}

export class JenkinsCoverageService {
  private readonly cache: JenkinsDataCache;
  private cacheTtlMs?: number;

  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    options: JenkinsCoverageServiceOptions
  ) {
    this.cache = new JenkinsDataCache(undefined, options.maxCacheEntries);
    this.cacheTtlMs = options.cacheTtlMs;
  }

  updateCacheTtlMs(cacheTtlMs?: number): void {
    this.cacheTtlMs = cacheTtlMs;
  }

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
    if (buildCompleted) {
      const cached = this.cache.get<JenkinsCoverageOverview>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    } else {
      this.cache.delete(cacheKey);
    }

    const api = new JenkinsCoverageApi(await this.clientProvider.createClientContext(environment));
    try {
      const overview = await api.getCoverageOverview(buildUrl, actionPath);
      if (buildCompleted) {
        if (overview) {
          this.cache.set(cacheKey, overview, this.cacheTtlMs);
        } else {
          this.cache.delete(cacheKey);
        }
      }
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
    if (buildCompleted) {
      const cached = this.cache.get<JenkinsModifiedCoverageFile[]>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    } else {
      this.cache.delete(cacheKey);
    }

    const api = new JenkinsCoverageApi(await this.clientProvider.createClientContext(environment));
    try {
      const files = await api.getModifiedCoverageFiles(buildUrl, actionPath);
      if (buildCompleted) {
        if (files) {
          this.cache.set(cacheKey, files, this.cacheTtlMs);
        } else {
          this.cache.delete(cacheKey);
        }
      }
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
    if (buildCompleted) {
      const cached = this.cache.get<string>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    } else {
      this.cache.delete(cacheKey);
    }

    const api = new JenkinsCoverageApi(await this.clientProvider.createClientContext(environment));
    try {
      const actionPath = await api.discoverCoverageActionPath(buildUrl);
      if (buildCompleted) {
        if (actionPath) {
          this.cache.set(cacheKey, actionPath, this.cacheTtlMs);
        } else {
          this.cache.delete(cacheKey);
        }
      }
      return actionPath;
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  private async buildCacheKey(
    environment: JenkinsEnvironmentRef,
    kind: string,
    buildUrl: string,
    actionPath: string
  ): Promise<string> {
    const authSignature = await this.clientProvider.getAuthSignature(environment);
    return this.cache.buildKey(environment, kind, `${buildUrl}::${actionPath}`, authSignature);
  }
}

function normalizeCoverageActionPath(actionPath?: string): string {
  const normalized = actionPath?.trim().replace(/^\/+|\/+$/g, "");
  return normalized && normalized.length > 0 ? normalized : "coverage";
}

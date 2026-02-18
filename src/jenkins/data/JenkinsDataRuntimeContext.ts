import type { JenkinsClient } from "../JenkinsClient";
import type { JenkinsClientProvider } from "../JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { JenkinsDataCache } from "./JenkinsDataCache";
import type {
  BuildParameterPayload,
  BuildParameterRequestPreparer,
  PreparedBuildParametersRequest
} from "./JenkinsDataTypes";

export interface JenkinsDataRuntimeContextOptions {
  buildParameterRequestPreparer: BuildParameterRequestPreparer;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

export class JenkinsDataRuntimeContext {
  private readonly cache: JenkinsDataCache;
  private readonly buildParameterRequestPreparer: BuildParameterRequestPreparer;
  private cacheTtlMs?: number;

  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    options: JenkinsDataRuntimeContextOptions
  ) {
    this.cache = new JenkinsDataCache(undefined, options.maxCacheEntries);
    this.buildParameterRequestPreparer = options.buildParameterRequestPreparer;
    this.cacheTtlMs = options.cacheTtlMs;
  }

  getCache(): JenkinsDataCache {
    return this.cache;
  }

  getCacheTtlMs(): number | undefined {
    return this.cacheTtlMs;
  }

  setCacheTtlMs(cacheTtlMs?: number): void {
    this.cacheTtlMs = cacheTtlMs;
  }

  clearCache(): void {
    this.cache.clear();
  }

  clearCacheForEnvironment(environmentId: string): void {
    this.cache.clearForEnvironment(environmentId);
  }

  async getClient(environment: JenkinsEnvironmentRef): Promise<JenkinsClient> {
    return this.clientProvider.getClient(environment);
  }

  async buildCacheKey(
    environment: JenkinsEnvironmentRef,
    kind: string,
    path?: string
  ): Promise<string> {
    const authSignature = await this.clientProvider.getAuthSignature(environment);
    return this.cache.buildKey(environment, kind, path, authSignature);
  }

  async prepareBuildParameters(
    params: URLSearchParams | BuildParameterPayload | undefined
  ): Promise<PreparedBuildParametersRequest> {
    return this.buildParameterRequestPreparer.prepareBuildParameters(params);
  }
}

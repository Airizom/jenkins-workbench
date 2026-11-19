import { isBuildQueueId } from "../../shared/build/BuildCompletionEvidence";
import type {
  BuildParameterPayload,
  BuildParameterRequestPreparer,
  PreparedBuildParametersRequest
} from "../BuildParameterRequests";
import type { JenkinsClient } from "../JenkinsClient";
import type { JenkinsClientProvider } from "../JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../types";
import { JenkinsDataCache } from "./JenkinsDataCache";

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

  async createEnvironmentDiagnosticsClient(
    environment: JenkinsEnvironmentRef
  ): Promise<JenkinsClient> {
    return this.clientProvider.createEnvironmentDiagnosticsClient(environment);
  }

  async buildCacheKey(
    environment: JenkinsEnvironmentRef,
    kind: string,
    path?: string
  ): Promise<string> {
    const authSignature = await this.clientProvider.getAuthSignature(environment);
    return this.cache.buildKey(environment, kind, path, authSignature);
  }

  /** A numbered URL may be reused. Only share observed run data across loads with queue evidence. */
  async buildRunCacheKey(
    environment: JenkinsEnvironmentRef,
    kind: string,
    path: string,
    run?: Pick<JenkinsBuildDetails, "queueId" | "result">
  ): Promise<string | undefined> {
    if (!run) return this.buildCacheKey(environment, kind, path);
    if (!isBuildQueueId(run.queueId)) return undefined;
    const identity = JSON.stringify([environment.scope, path, run.queueId, run.result]);
    return this.buildCacheKey(environment, kind, identity);
  }

  async prepareBuildParameters(
    params: URLSearchParams | BuildParameterPayload | undefined
  ): Promise<PreparedBuildParametersRequest> {
    return this.buildParameterRequestPreparer.prepareBuildParameters(params);
  }
}

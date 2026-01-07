import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsBuildTriggerOptions,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsParameterDefinition,
  JenkinsQueueItem,
  JenkinsWorkflowRun
} from "./JenkinsClient";
import type { JenkinsClientProvider } from "./JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import { JenkinsDataCache } from "./data/JenkinsDataCache";
import { toBuildActionError } from "./data/JenkinsDataErrors";
import type {
  ConsoleTextResult,
  ConsoleTextTailResult,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
  JobParameter,
  JobParameterKind,
  JobSearchEntry,
  JobSearchOptions,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult
} from "./data/JenkinsDataTypes";
import { JenkinsJobIndex } from "./data/JenkinsJobIndex";
import { JenkinsRequestError } from "./errors";
import type { JenkinsTestReport } from "./types";
import type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "./request";
import { resolveNodeUrl } from "./urls";

export type {
  BuildActionErrorCode,
  CancellationChecker,
  CancellationInput,
  CancellationSignal,
  ConsoleTextResult,
  ConsoleTextTailResult,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
  JobParameter,
  JobParameterKind,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult,
  JobPathSegment,
  JobSearchEntry,
  JobSearchOptions
} from "./data/JenkinsDataTypes";
export { BuildActionError, CancellationError } from "./errors";

export interface JenkinsDataServiceOptions {
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

export interface BuildListFetchOptions {
  detailLevel?: "summary" | "details";
  includeParameters?: boolean;
}

export class JenkinsDataService {
  private readonly cache: JenkinsDataCache;
  private readonly jobIndex: JenkinsJobIndex;
  private cacheTtlMs?: number;

  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    options?: JenkinsDataServiceOptions
  ) {
    this.cache = new JenkinsDataCache(undefined, options?.maxCacheEntries);
    this.jobIndex = new JenkinsJobIndex(this.cache, clientProvider);
    this.cacheTtlMs = options?.cacheTtlMs;
  }

  clearCache(): void {
    this.cache.clear();
  }

  clearCacheForEnvironment(environmentId: string): void {
    this.cache.clearForEnvironment(environmentId);
  }

  updateCacheTtlMs(cacheTtlMs?: number): void {
    this.cacheTtlMs = cacheTtlMs;
  }

  async getJobsForEnvironment(environment: JenkinsEnvironmentRef): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.buildCacheKey(environment, "jobs");
    return this.cache.getOrLoad(
      cacheKey,
      async () => {
        const client = await this.clientProvider.getClient(environment);
        const jobs = await client.getRootJobs();
        return this.mapJobs(client, jobs);
      },
      this.cacheTtlMs
    );
  }

  async getJobsForFolder(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.buildCacheKey(environment, "folder", folderUrl);
    return this.cache.getOrLoad(
      cacheKey,
      async () => {
        const client = await this.clientProvider.getClient(environment);
        const jobs = await client.getFolderJobs(folderUrl);
        return this.mapJobs(client, jobs);
      },
      this.cacheTtlMs
    );
  }

  async getAllJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): Promise<JobSearchEntry[]> {
    return this.jobIndex.getAllJobsForEnvironment(environment, options);
  }

  async *iterateJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): AsyncIterable<JobSearchEntry[]> {
    for await (const batch of this.jobIndex.iterateJobsForEnvironment(environment, options)) {
      yield batch;
    }
  }

  async getBuildsForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    limit: number,
    options?: BuildListFetchOptions
  ): Promise<JenkinsBuild[]> {
    const detailLevel = options?.detailLevel ?? "summary";
    const includeParameters = options?.includeParameters ?? false;
    const cacheKind = `builds-${detailLevel}-${includeParameters ? "params" : "noparams"}`;
    const cacheKey = await this.buildCacheKey(environment, cacheKind, jobUrl);
    return this.cache.getOrLoad(
      cacheKey,
      async () => {
        const client = await this.clientProvider.getClient(environment);
        return client.getBuilds(jobUrl, limit, {
          includeDetails: detailLevel === "details",
          includeParameters
        });
      },
      this.cacheTtlMs
    );
  }

  async getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsBuildDetails> {
    const cacheKey = await this.buildCacheKey(environment, "build-details", buildUrl);
    const cached = this.cache.get<JenkinsBuildDetails>(cacheKey);
    if (cached && !cached.building) {
      return cached;
    }

    const client = await this.clientProvider.getClient(environment);
    try {
      const details = await client.getBuildDetails(buildUrl);
      if (!details.building) {
        this.cache.set(cacheKey, details, this.cacheTtlMs);
      } else {
        this.cache.delete(cacheKey);
      }
      return details;
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getBuildArtifacts(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsArtifact[]> {
    const client = await this.clientProvider.getClient(environment);
    return client.getBuildArtifacts(buildUrl);
  }

  async getWorkflowRun(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsWorkflowRun | undefined> {
    const unsupportedKey = await this.buildCacheKey(environment, "wfapi-unsupported", buildUrl);
    if (this.cache.has(unsupportedKey)) {
      return undefined;
    }
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getWorkflowRun(buildUrl);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        this.cache.set(unsupportedKey, true, this.cacheTtlMs);
        return undefined;
      }
      throw toBuildActionError(error);
    }
  }

  async getArtifact(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    const client = await this.clientProvider.getClient(environment);
    return client.getArtifact(buildUrl, relativePath, options);
  }

  async getArtifactStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    const client = await this.clientProvider.getClient(environment);
    return client.getArtifactStream(buildUrl, relativePath, options);
  }

  async getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<ConsoleTextResult> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getConsoleText(buildUrl, maxChars);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getConsoleTextTail(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<ConsoleTextTailResult> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getConsoleTextTail(buildUrl, maxChars);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number
  ): Promise<ProgressiveConsoleTextResult> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getConsoleTextProgressive(buildUrl, start);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<ProgressiveConsoleHtmlResult> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getConsoleHtmlProgressive(buildUrl, start, annotator);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getLastFailedBuild(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<JenkinsBuild | undefined> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getLastFailedBuild(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getTestReport(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport | undefined> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getTestReport(buildUrl, options);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        return undefined;
      }
      throw toBuildActionError(error);
    }
  }

  async getNodes(environment: JenkinsEnvironmentRef): Promise<JenkinsNodeInfo[]> {
    const cacheKey = await this.buildCacheKey(environment, "nodes");
    return this.cache.getOrLoad(
      cacheKey,
      async () => {
        const client = await this.clientProvider.getClient(environment);
        const nodes = await client.getNodes();
        return nodes.map((node) => ({
          ...node,
          nodeUrl: resolveNodeUrl(environment.url, node)
        }));
      },
      this.cacheTtlMs
    );
  }

  async getQueueItems(environment: JenkinsEnvironmentRef): Promise<JenkinsQueueItemInfo[]> {
    const client = await this.clientProvider.getClient(environment);
    try {
      const items = await client.getQueue();
      return this.mapQueueItems(items);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getJobParameters(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<JobParameter[]> {
    const cacheKey = await this.buildCacheKey(environment, "parameters", jobUrl);
    return this.cache.getOrLoad(
      cacheKey,
      async () => {
        const client = await this.clientProvider.getClient(environment);
        try {
          const parameters = await client.getJobParameters(jobUrl);
          return parameters.map((parameter) => this.mapJobParameter(parameter));
        } catch (error) {
          throw toBuildActionError(error);
        }
      },
      this.cacheTtlMs
    );
  }

  async triggerBuild(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<{ queueLocation?: string }> {
    return this.triggerBuildInternal(environment, jobUrl, { mode: "build" });
  }

  async triggerBuildWithParameters(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    params?: URLSearchParams,
    options?: { allowEmptyParams?: boolean }
  ): Promise<{ queueLocation?: string }> {
    return this.triggerBuildInternal(environment, jobUrl, {
      mode: "buildWithParameters",
      params,
      allowEmptyParams: options?.allowEmptyParams
    });
  }

  private async triggerBuildInternal(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    options: JenkinsBuildTriggerOptions
  ): Promise<{ queueLocation?: string }> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.triggerBuild(jobUrl, options);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async stopBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.stopBuild(buildUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async replayBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.replayBuild(buildUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async rebuildBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.rebuildBuild(buildUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async cancelQueueItem(environment: JenkinsEnvironmentRef, queueId: number): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.cancelQueueItem(queueId);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  private async buildCacheKey(
    environment: JenkinsEnvironmentRef,
    kind: string,
    path?: string
  ): Promise<string> {
    const authSignature = await this.clientProvider.getAuthSignature(environment);
    return this.cache.buildKey(environment, kind, path, authSignature);
  }

  private mapJobParameter(parameter: JenkinsParameterDefinition): JobParameter {
    const normalizedType = (parameter.type ?? "").toLowerCase();
    let kind: JobParameterKind = "string";

    if (normalizedType.includes("booleanparameterdefinition")) {
      kind = "boolean";
    } else if (
      normalizedType.includes("choiceparameterdefinition") ||
      (parameter.choices && parameter.choices.length > 0)
    ) {
      kind = "choice";
    } else if (normalizedType.includes("passwordparameterdefinition")) {
      kind = "password";
    }

    return {
      name: parameter.name,
      kind,
      defaultValue: parameter.defaultValue,
      choices: parameter.choices,
      description: parameter.description
    };
  }

  private mapJobs(
    client: { classifyJob(job: JenkinsJob): JenkinsJobKind },
    jobs: JenkinsJob[]
  ): JenkinsJobInfo[] {
    return jobs.map((job) => ({
      name: job.name,
      url: job.url,
      color: job.color,
      kind: client.classifyJob(job)
    }));
  }

  private mapQueueItems(items: JenkinsQueueItem[]): JenkinsQueueItemInfo[] {
    return items.map((item, index) => {
      const name =
        typeof item.task?.name === "string" && item.task.name.trim().length > 0
          ? item.task.name.trim()
          : `Queue item ${item.id}`;
      return {
        id: item.id,
        name,
        position: index + 1,
        reason: typeof item.why === "string" ? item.why.trim() || undefined : undefined,
        inQueueSince: typeof item.inQueueSince === "number" ? item.inQueueSince : undefined,
        taskUrl: item.task?.url
      };
    });
  }
}

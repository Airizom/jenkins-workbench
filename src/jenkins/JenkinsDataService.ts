import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsBuildTriggerOptions,
  JenkinsItemCreateKind,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsNodeDetails,
  JenkinsParameterDefinition,
  JenkinsPendingInputAction,
  JenkinsPendingInputParameterDefinition,
  JenkinsQueueItem,
  JenkinsRestartFromStageInfo,
  JenkinsWorkflowRun,
  ScanMultibranchResult
} from "./JenkinsClient";
import type { JenkinsClientProvider } from "./JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";
import { JenkinsDataCache } from "./data/JenkinsDataCache";
import {
  toBuildActionError,
  toJenkinsActionError,
  toJobManagementActionError
} from "./data/JenkinsDataErrors";
import type {
  BuildParameterPayload,
  BuildParameterRequestPreparer,
  ConsoleTextResult,
  ConsoleTextTailResult,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
  JobParameter,
  JobParameterKind,
  JobSearchEntry,
  JobSearchOptions,
  PendingInputAction,
  PendingInputSummary,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult
} from "./data/JenkinsDataTypes";
import { JenkinsJobIndex } from "./data/JenkinsJobIndex";
import { JenkinsRequestError } from "./errors";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "./request";
import type { JenkinsTestReport } from "./types";
import { resolveNodeUrl } from "./urls";

export type {
  BuildActionErrorCode,
  BuildParameterPayload,
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
  PendingInputAction,
  PendingInputSummary,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult,
  JobPathSegment,
  JobSearchEntry,
  JobSearchOptions
} from "./data/JenkinsDataTypes";
export { BuildActionError, CancellationError, JobManagementActionError } from "./errors";

export interface JenkinsDataServiceOptions {
  buildParameterRequestPreparer: BuildParameterRequestPreparer;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

export interface BuildListFetchOptions {
  detailLevel?: "summary" | "details";
  includeParameters?: boolean;
}

type NodeOfflineToggleStatus = "toggled" | "no_change" | "not_temporarily_offline";

interface NodeOfflineToggleResult {
  status: NodeOfflineToggleStatus;
  details: JenkinsNodeDetails;
}

type NodeLaunchStatus = "launched" | "no_change" | "not_launchable" | "temporarily_offline";

interface NodeLaunchResult {
  status: NodeLaunchStatus;
  details: JenkinsNodeDetails;
}

const PENDING_INPUT_ACTIONS_TTL_MS = 5000;
const PENDING_INPUT_SUMMARY_TTL_MS = 60_000;
const PENDING_INPUT_UNSUPPORTED_TTL_MS = 5 * 60 * 1000;

export class JenkinsDataService {
  private readonly cache: JenkinsDataCache;
  private readonly jobIndex: JenkinsJobIndex;
  private readonly buildParameterRequestPreparer: BuildParameterRequestPreparer;
  private cacheTtlMs?: number;

  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    options: JenkinsDataServiceOptions
  ) {
    this.cache = new JenkinsDataCache(undefined, options?.maxCacheEntries);
    this.jobIndex = new JenkinsJobIndex(this.cache, clientProvider);
    this.buildParameterRequestPreparer = options.buildParameterRequestPreparer;
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

  async getJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<JenkinsJob> {
    const client = await this.clientProvider.getClient(environment);
    return client.getJob(jobUrl);
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

  async getPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<PendingInputAction[]> {
    const cacheKey = await this.buildCacheKey(environment, "pending-inputs", buildUrl);
    const summaryKey = await this.buildCacheKey(environment, "pending-input-summary", buildUrl);
    const unsupportedKey = await this.buildCacheKey(
      environment,
      "pending-inputs-unsupported",
      buildUrl
    );
    if (this.cache.has(unsupportedKey)) {
      return [];
    }
    const cached = this.cache.get<PendingInputAction[]>(cacheKey);
    if (options?.mode === "cached") {
      return cached ?? [];
    }
    if (cached && options?.mode !== "refresh") {
      return cached;
    }
    return this.fetchPendingInputActions(environment, buildUrl, {
      cacheKey,
      summaryKey,
      unsupportedKey
    });
  }

  async getPendingInputSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh"; maxAgeMs?: number }
  ): Promise<PendingInputSummary> {
    const cacheKey = await this.buildCacheKey(environment, "pending-input-summary", buildUrl);
    const cached = this.cache.get<PendingInputSummary>(cacheKey);
    if (options?.mode === "cached") {
      return cached ?? this.buildPendingInputSummary([], 0);
    }
    if (cached && options?.mode !== "refresh") {
      const maxAgeMs = options?.maxAgeMs;
      if (!Number.isFinite(maxAgeMs) || typeof maxAgeMs !== "number") {
        return cached;
      }
      const ageMs = Date.now() - cached.fetchedAt;
      if (ageMs <= maxAgeMs) {
        return cached;
      }
    }
    const summary = await this.refreshPendingInputSummary(environment, buildUrl);
    return summary;
  }

  async refreshPendingInputSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<PendingInputSummary> {
    const actions = await this.getPendingInputActions(environment, buildUrl, {
      mode: "refresh"
    });
    const summary = this.buildPendingInputSummary(actions);
    const cacheKey = await this.buildCacheKey(environment, "pending-input-summary", buildUrl);
    this.cache.set(cacheKey, summary, PENDING_INPUT_SUMMARY_TTL_MS);
    return summary;
  }

  async approveInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.proceedInput(buildUrl, inputId, options);
    } catch (error) {
      throw toBuildActionError(error);
    } finally {
      await this.clearPendingInputCache(environment, buildUrl);
    }
  }

  async rejectInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    abortUrl?: string
  ): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.abortInput(buildUrl, inputId, abortUrl);
    } catch (error) {
      throw toBuildActionError(error);
    } finally {
      await this.clearPendingInputCache(environment, buildUrl);
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

  async getNodeDetails(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    options?: { mode?: "refresh"; detailLevel?: "basic" | "advanced" }
  ): Promise<JenkinsNodeDetails> {
    const detailLevel = options?.detailLevel ?? "basic";
    const cacheKey = await this.buildCacheKey(environment, `node-details-${detailLevel}`, nodeUrl);
    const cached =
      options?.mode !== "refresh" ? this.cache.get<JenkinsNodeDetails>(cacheKey) : undefined;
    if (cached) {
      return cached;
    }
    const client = await this.clientProvider.getClient(environment);
    try {
      const details = await client.getNodeDetails(nodeUrl, { detailLevel });
      this.cache.set(cacheKey, details, this.cacheTtlMs);
      return details;
    } catch (error) {
      throw toJenkinsActionError(error);
    }
  }

  async setNodeTemporarilyOffline(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    targetOffline: boolean,
    reason?: string
  ): Promise<NodeOfflineToggleResult> {
    try {
      const details = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      const isOffline = details.offline === true;
      const isTemporarilyOffline = details.temporarilyOffline === true;

      if (targetOffline) {
        if (isTemporarilyOffline || isOffline) {
          return { status: "no_change", details };
        }
        this.clearCacheForEnvironment(environment.environmentId);
        const client = await this.clientProvider.getClient(environment);
        await client.toggleNodeTemporarilyOffline(nodeUrl, reason);
        const refreshed = await this.getNodeDetails(environment, nodeUrl, {
          mode: "refresh",
          detailLevel: "basic"
        });
        return { status: "toggled", details: refreshed };
      }

      if (!isTemporarilyOffline) {
        return { status: isOffline ? "not_temporarily_offline" : "no_change", details };
      }
      this.clearCacheForEnvironment(environment.environmentId);
      const client = await this.clientProvider.getClient(environment);
      await client.toggleNodeTemporarilyOffline(nodeUrl);
      const refreshed = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      return { status: "toggled", details: refreshed };
    } catch (error) {
      throw toJenkinsActionError(error);
    }
  }

  async launchNodeAgent(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeLaunchResult> {
    try {
      const details = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      const canLaunch = details.launchSupported === true;
      if (!details.offline) {
        return { status: "no_change", details };
      }
      if (details.temporarilyOffline) {
        return { status: "temporarily_offline", details };
      }
      if (!canLaunch) {
        return { status: "not_launchable", details };
      }
      this.clearCacheForEnvironment(environment.environmentId);
      const client = await this.clientProvider.getClient(environment);
      await client.launchNodeAgent(nodeUrl);
      const refreshed = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      return { status: "launched", details: refreshed };
    } catch (error) {
      throw toJenkinsActionError(error);
    }
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

  async getQueueItem(
    environment: JenkinsEnvironmentRef,
    queueId: number
  ): Promise<JenkinsQueueItem> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getQueueItem(queueId);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getJobConfigXml(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<string> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getJobConfigXml(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async updateJobConfigXml(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    xml: string
  ): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.updateJobConfigXml(jobUrl, xml);
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
    params?: URLSearchParams | BuildParameterPayload,
    options?: { allowEmptyParams?: boolean }
  ): Promise<{ queueLocation?: string }> {
    const prepared = await this.buildParameterRequestPreparer.prepareBuildParameters(params);
    return this.triggerBuildInternal(environment, jobUrl, {
      mode: "buildWithParameters",
      prepared,
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

  async getRestartFromStageInfo(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsRestartFromStageInfo> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.getRestartFromStageInfo(buildUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async restartPipelineFromStage(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    stageName: string
  ): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.restartPipelineFromStage(buildUrl, stageName);
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

  async enableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.enableJob(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async disableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.disableJob(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async scanMultibranch(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<ScanMultibranchResult> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.scanMultibranch(folderUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async renameJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.renameJob(jobUrl, newName);
    } catch (error) {
      throw toJobManagementActionError(error);
    }
  }

  async deleteJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const client = await this.clientProvider.getClient(environment);
    try {
      await client.deleteJob(jobUrl);
    } catch (error) {
      throw toJobManagementActionError(error);
    }
  }

  async copyJob(
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    sourceName: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.copyJob(parentUrl, sourceName, newName);
    } catch (error) {
      throw toJobManagementActionError(error);
    }
  }

  async createItem(
    kind: JenkinsItemCreateKind,
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    const client = await this.clientProvider.getClient(environment);
    try {
      return await client.createItem(kind, parentUrl, newName);
    } catch (error) {
      throw toJobManagementActionError(error);
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

  private async clearPendingInputCache(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<void> {
    const cacheKey = await this.buildCacheKey(environment, "pending-inputs", buildUrl);
    const summaryKey = await this.buildCacheKey(environment, "pending-input-summary", buildUrl);
    const unsupportedKey = await this.buildCacheKey(
      environment,
      "pending-inputs-unsupported",
      buildUrl
    );
    this.cache.delete(cacheKey);
    this.cache.delete(summaryKey);
    this.cache.delete(unsupportedKey);
  }

  private async fetchPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    keys: { cacheKey: string; summaryKey: string; unsupportedKey: string }
  ): Promise<PendingInputAction[]> {
    const client = await this.clientProvider.getClient(environment);
    try {
      const actions = await client.getPendingInputActions(buildUrl);
      const mapped = this.mapPendingInputActions(actions);
      this.cache.set(keys.cacheKey, mapped, PENDING_INPUT_ACTIONS_TTL_MS);
      this.cache.set(
        keys.summaryKey,
        this.buildPendingInputSummary(mapped),
        PENDING_INPUT_SUMMARY_TTL_MS
      );
      return mapped;
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        this.cache.set(
          keys.unsupportedKey,
          true,
          this.cacheTtlMs ?? PENDING_INPUT_UNSUPPORTED_TTL_MS
        );
        this.cache.set(keys.cacheKey, [], PENDING_INPUT_ACTIONS_TTL_MS);
        this.cache.set(
          keys.summaryKey,
          this.buildPendingInputSummary([]),
          PENDING_INPUT_SUMMARY_TTL_MS
        );
        return [];
      }
      throw toBuildActionError(error);
    }
  }

  private mapJobParameter(parameter: JenkinsParameterDefinition): JobParameter {
    const classification = this.classifyParameterKind(parameter.type, {
      choices: parameter.choices
    });

    return {
      name: parameter.name,
      kind: classification.kind,
      defaultValue: parameter.defaultValue,
      choices: parameter.choices,
      description: parameter.description,
      rawType: parameter.type,
      isSensitive: classification.isSensitive,
      runProjectName: parameter.projectName,
      multiSelectDelimiter: parameter.multiSelectDelimiter,
      allowsMultiple: classification.allowsMultiple
    };
  }

  private mapPendingInputActions(actions: JenkinsPendingInputAction[]): PendingInputAction[] {
    const results: PendingInputAction[] = [];
    for (const action of actions) {
      const id = (action.id ?? action.inputId ?? "").trim();
      if (!id) {
        continue;
      }
      const message = (action.message ?? "").trim() || "Input required";
      const submitter = this.normalizeString(action.submitter);
      const proceedText = this.normalizeString(action.proceedText);
      const proceedUrl = this.normalizeString(action.proceedUrl);
      const abortUrl = this.normalizeString(action.abortUrl);
      const parameters = this.mapPendingInputParameters(action);
      results.push({
        id,
        message,
        submitter,
        proceedText,
        proceedUrl,
        abortUrl,
        parameters
      });
    }
    return results;
  }

  private buildPendingInputSummary(
    actions: PendingInputAction[],
    fetchedAt = Date.now()
  ): PendingInputSummary {
    const signature = this.buildPendingInputSignature(actions);
    const message = actions[0]?.message;
    return {
      awaitingInput: actions.length > 0,
      count: actions.length,
      signature,
      message,
      fetchedAt
    };
  }

  private buildPendingInputSignature(actions: PendingInputAction[]): string | undefined {
    const normalizedActions = actions.map((action) => ({
      id: action.id.trim(),
      message: action.message,
      submitter: action.submitter ?? "",
      proceedText: action.proceedText ?? "",
      parameters: [...action.parameters]
        .map((param) => ({
          name: param.name,
          kind: param.kind,
          description: param.description ?? "",
          defaultValue: param.defaultValue ?? "",
          choices: Array.isArray(param.choices) ? [...param.choices].sort() : []
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
    }));

    normalizedActions.sort(
      (a, b) => a.id.localeCompare(b.id) || a.message.localeCompare(b.message)
    );

    const parts = normalizedActions
      .map((action) => JSON.stringify(action))
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("|") : undefined;
  }

  private mapPendingInputParameters(action: JenkinsPendingInputAction): JobParameter[] {
    const rawParameters = Array.isArray(action.parameters)
      ? action.parameters
      : Array.isArray(action.inputs)
        ? action.inputs
        : [];
    const results: JobParameter[] = [];
    for (const parameter of rawParameters) {
      if (!parameter || !parameter.name) {
        continue;
      }
      results.push(this.mapPendingInputParameter(parameter));
    }
    return results;
  }

  private mapPendingInputParameter(
    parameter: JenkinsPendingInputParameterDefinition
  ): JobParameter {
    const choices = Array.isArray(parameter.choices)
      ? parameter.choices.map((choice) => String(choice))
      : undefined;
    const classification = this.classifyParameterKind(parameter.type, {
      choices,
      includeLooseTokens: true
    });

    const rawDefault = parameter.defaultParameterValue?.value ?? parameter.defaultValue;
    const defaultValue = this.formatParameterDefaultValue(rawDefault);

    return {
      name: parameter.name ?? "parameter",
      kind: classification.kind,
      defaultValue,
      choices,
      description: parameter.description,
      rawType: parameter.type,
      isSensitive: classification.isSensitive,
      runProjectName: parameter.projectName,
      multiSelectDelimiter: parameter.multiSelectDelimiter,
      allowsMultiple: classification.allowsMultiple
    };
  }

  private formatParameterDefaultValue(
    value: unknown
  ): string | number | boolean | string[] | undefined {
    switch (typeof value) {
      case "string":
      case "number":
      case "boolean":
        return value;
      case "undefined":
        return undefined;
      case "bigint":
        return value.toString();
      case "symbol":
        return value.description ?? value.toString();
      case "function":
        return value.name ? `[function ${value.name}]` : "[function]";
      case "object":
        if (value === null) {
          return undefined;
        }
        if (Array.isArray(value)) {
          return value.map((entry) => String(entry));
        }
        try {
          return JSON.stringify(value);
        } catch {
          return "[object]";
        }
      default:
        return undefined;
    }
  }

  private classifyParameterKind(
    rawType: string | undefined,
    options?: { choices?: string[]; includeLooseTokens?: boolean }
  ): { kind: JobParameterKind; isSensitive: boolean; allowsMultiple: boolean } {
    const normalizedType = (rawType ?? "").toLowerCase();
    const hasChoices = Boolean(options?.choices && options.choices.length > 0);
    const includeLooseTokens = options?.includeLooseTokens === true;

    if (normalizedType.includes("credentialsparameterdefinition")) {
      return { kind: "credentials", isSensitive: true, allowsMultiple: false };
    }
    if (normalizedType.includes("runparameterdefinition")) {
      return { kind: "run", isSensitive: false, allowsMultiple: false };
    }
    if (normalizedType.includes("fileparameterdefinition")) {
      return { kind: "file", isSensitive: false, allowsMultiple: false };
    }
    if (normalizedType.includes("textparameterdefinition")) {
      return { kind: "text", isSensitive: false, allowsMultiple: false };
    }
    if (
      normalizedType.includes("extendedchoice") ||
      normalizedType.includes("multiselect") ||
      normalizedType.includes("multichoice")
    ) {
      return { kind: "multiChoice", isSensitive: false, allowsMultiple: true };
    }
    if (
      normalizedType.includes("booleanparameterdefinition") ||
      (includeLooseTokens && normalizedType.includes("boolean"))
    ) {
      return { kind: "boolean", isSensitive: false, allowsMultiple: false };
    }
    if (
      normalizedType.includes("choiceparameterdefinition") ||
      (includeLooseTokens && normalizedType.includes("choice")) ||
      hasChoices
    ) {
      return { kind: "choice", isSensitive: false, allowsMultiple: false };
    }
    if (
      normalizedType.includes("passwordparameterdefinition") ||
      (includeLooseTokens && normalizedType.includes("password"))
    ) {
      return { kind: "password", isSensitive: true, allowsMultiple: false };
    }
    return { kind: "string", isSensitive: false, allowsMultiple: false };
  }

  private normalizeString(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
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

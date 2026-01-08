import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsBuildTriggerOptions,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsPendingInputAction,
  JenkinsPendingInputParameterDefinition,
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
  PendingInputAction,
  PendingInputSummary,
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
  PendingInputAction,
  PendingInputSummary,
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

const PENDING_INPUT_ACTIONS_TTL_MS = 5000;
const PENDING_INPUT_SUMMARY_TTL_MS = 60_000;
const PENDING_INPUT_UNSUPPORTED_TTL_MS = 5 * 60 * 1000;

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
    const normalizedType = (parameter.type ?? "").toLowerCase();
    let kind: JobParameterKind = "string";

    if (normalizedType.includes("booleanparameterdefinition") || normalizedType.includes("boolean")) {
      kind = "boolean";
    } else if (
      normalizedType.includes("choiceparameterdefinition") ||
      normalizedType.includes("choice") ||
      (Array.isArray(parameter.choices) && parameter.choices.length > 0)
    ) {
      kind = "choice";
    } else if (
      normalizedType.includes("passwordparameterdefinition") ||
      normalizedType.includes("password")
    ) {
      kind = "password";
    }

    const rawDefault = parameter.defaultParameterValue?.value ?? parameter.defaultValue;
    const defaultValue = this.formatParameterDefaultValue(rawDefault);
    const choices = Array.isArray(parameter.choices)
      ? parameter.choices.map((choice) => String(choice))
      : undefined;

    return {
      name: parameter.name ?? "parameter",
      kind,
      defaultValue,
      choices,
      description: parameter.description
    };
  }

  private formatParameterDefaultValue(
    value: unknown
  ): string | number | boolean | undefined {
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
        try {
          return JSON.stringify(value);
        } catch {
          return "[object]";
        }
      default:
        return undefined;
    }
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

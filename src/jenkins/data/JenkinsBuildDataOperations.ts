import { JenkinsRequestError } from "../errors";
import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsBuildTriggerOptions,
  JenkinsClient,
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload,
  JenkinsRestartFromStageInfo,
  JenkinsWorkflowRun
} from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "../request";
import type { JenkinsTestReport } from "../types";
import { applyBuildKeepForever, deleteBuildWithRetention } from "./JenkinsBuildRetention";
import { callOptionalBuildEndpoint, toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type {
  BuildParameterPayload,
  ConsoleTextResult,
  ConsoleTextTailResult,
  FlowNodeDetailsResult,
  FlowNodeLogResult,
  JenkinsBuildManagementState,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult
} from "./JenkinsDataTypes";

const BUILD_DETAILS_CACHE_KINDS = [
  "build-revisions",
  "build-status",
  "build-details-causes-params",
  "build-details-causes",
  "build-details-params",
  "build-details"
] as const;

type BuildDetailsCacheKind = (typeof BUILD_DETAILS_CACHE_KINDS)[number];

export class JenkinsBuildDataOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getBuildsForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    limit: number,
    options?: {
      detailLevel?: "summary" | "details" | "revisions";
      offset?: number;
      includeParameters?: boolean;
      includeDescription?: boolean;
      bypassCache?: boolean;
    }
  ): Promise<JenkinsBuild[]> {
    const detailLevel = options?.detailLevel ?? "summary";
    const includeParameters = options?.includeParameters ?? false;
    const includeDescription = options?.includeDescription ?? false;
    const bypassCache = options?.bypassCache ?? false;
    const client = await this.context.getClient(environment);
    const load = () =>
      client.getBuilds(jobUrl, limit, {
        offset: options?.offset,
        includeDetails: detailLevel === "details",
        includeRevisions: detailLevel === "revisions",
        includeParameters,
        includeDescription
      });
    if (bypassCache) {
      return load();
    }
    const rangeKind = options?.offset === undefined ? "recent" : `paged-${options.offset}`;
    const descriptionKind = includeDescription ? "-desc" : "";
    const cacheKind = `builds-${detailLevel}-${includeParameters ? "params" : "noparams"}${descriptionKind}-${limit}-${rangeKind}`;
    const cacheKey = await this.context.buildCacheKey(environment, cacheKind, jobUrl);
    return this.context.getCache().getOrLoad(cacheKey, load, this.context.getCacheTtlMs());
  }

  async getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: {
      includeCauses?: boolean;
      includeParameters?: boolean;
      statusOnly?: boolean;
      revisionsOnly?: boolean;
      bypassCache?: boolean;
    }
  ): Promise<JenkinsBuildDetails> {
    const cacheKind: BuildDetailsCacheKind = options?.revisionsOnly
      ? "build-revisions"
      : options?.statusOnly
        ? "build-status"
        : options?.includeCauses
          ? options.includeParameters
            ? "build-details-causes-params"
            : "build-details-causes"
          : options?.includeParameters
            ? "build-details-params"
            : "build-details";
    const cacheKey = await this.context.buildCacheKey(environment, cacheKind, buildUrl);
    const cached = this.context.getCache().get<JenkinsBuildDetails>(cacheKey);
    if (cached && !cached.building && !options?.bypassCache) {
      return cached;
    }

    return this.context.getCache().withWriteGuard([cacheKey], async (cache) => {
      const client = await this.context.getClient(environment);
      try {
        const details = await client.getBuildDetails(buildUrl, options);
        if (!details.building) {
          cache.set(cacheKey, details, this.context.getCacheTtlMs());
        } else {
          cache.delete(cacheKey);
        }
        return details;
      } catch (error) {
        throw toBuildActionError(error);
      }
    });
  }

  async getBuildArtifacts(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsArtifact[]> {
    const client = await this.context.getClient(environment);
    return client.getBuildArtifacts(buildUrl);
  }

  async getWorkflowRun(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsWorkflowRun | undefined> {
    const unsupportedKey = await this.context.buildCacheKey(
      environment,
      "wfapi-unsupported",
      buildUrl
    );
    if (this.context.getCache().has(unsupportedKey)) {
      return undefined;
    }
    return this.context.getCache().withWriteGuard([unsupportedKey], async (cache) => {
      const client = await this.context.getClient(environment);
      try {
        return await client.getWorkflowRun(buildUrl);
      } catch (error) {
        if (error instanceof JenkinsRequestError && error.statusCode === 404) {
          cache.set(unsupportedKey, true, this.context.getCacheTtlMs());
          return undefined;
        }
        throw toBuildActionError(error);
      }
    });
  }

  async getArtifact(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    const client = await this.context.getClient(environment);
    return client.getArtifact(buildUrl, relativePath, options);
  }

  async getArtifactStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    const client = await this.context.getClient(environment);
    return client.getArtifactStream(buildUrl, relativePath, options);
  }

  async getArtifactArchiveStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { maxBytes?: number; signal?: AbortSignal }
  ): Promise<JenkinsStreamResponse> {
    options?.signal?.throwIfAborted();
    const client = await this.context.getClient(environment);
    options?.signal?.throwIfAborted();
    return client.getArtifactArchiveStream(buildUrl, options);
  }

  async getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<ConsoleTextResult> {
    return this.runBuildAction(environment, (client) => client.getConsoleText(buildUrl, maxChars));
  }

  async getConsoleTextHead(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxBytes: number
  ): Promise<ConsoleTextResult> {
    return this.runBuildAction(environment, (client) =>
      client.getConsoleTextHead(buildUrl, maxBytes)
    );
  }

  async getConsoleTextTail(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<ConsoleTextTailResult> {
    return this.runBuildAction(environment, (client) =>
      client.getConsoleTextTail(buildUrl, maxChars)
    );
  }

  async getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    maxBytes?: number
  ): Promise<ProgressiveConsoleTextResult> {
    return this.runBuildAction(environment, (client) =>
      client.getConsoleTextProgressive(buildUrl, start, maxBytes)
    );
  }

  async getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<ProgressiveConsoleHtmlResult> {
    return this.runBuildAction(environment, (client) =>
      client.getConsoleHtmlProgressive(buildUrl, start, annotator)
    );
  }

  async getFlowNodeLog(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string
  ): Promise<FlowNodeLogResult | undefined> {
    const client = await this.context.getClient(environment);
    return callOptionalBuildEndpoint(() => client.getFlowNodeLog(buildUrl, nodeId));
  }

  async getFlowNodeDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string
  ): Promise<FlowNodeDetailsResult | undefined> {
    const client = await this.context.getClient(environment);
    return callOptionalBuildEndpoint(() => client.getFlowNodeDetails(buildUrl, nodeId));
  }

  async getFlowNodeLogHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string,
    start: number,
    annotator?: string
  ): Promise<ProgressiveConsoleHtmlResult | undefined> {
    const client = await this.context.getClient(environment);
    return callOptionalBuildEndpoint(() =>
      client.getFlowNodeLogHtmlProgressive(buildUrl, nodeId, start, annotator)
    );
  }

  async getLastFailedBuild(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<JenkinsBuild | undefined> {
    return this.runBuildAction(environment, (client) => client.getLastFailedBuild(jobUrl));
  }

  async getTestReport(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport | undefined> {
    const client = await this.context.getClient(environment);
    return callOptionalBuildEndpoint(() => client.getTestReport(buildUrl, options));
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
    const prepared = await this.context.prepareBuildParameters(params);
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
    return this.runBuildAction(environment, (client) => client.triggerBuild(jobUrl, options));
  }

  async stopBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    await this.runBuildAction(environment, (client) => client.stopBuild(buildUrl));
  }

  /**
   * Deletes a build and confirms it is gone. Jenkins can answer the delete POST
   * successfully while refusing to delete kept or protected builds.
   *
   * With `releaseKeep`, a kept build is released first (refusing when a dependency
   * keeps it). If the delete then fails, keep-forever is restored best effort and the
   * delete error is rethrown.
   */
  async deleteBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { releaseKeep?: boolean }
  ): Promise<void> {
    await this.runBuildMutation(environment, buildUrl, async (client) => {
      await deleteBuildWithRetention(client, buildUrl, options?.releaseKeep);
    });
  }

  /**
   * Sets the keep-forever flag idempotently. Jenkins only exposes a toggle, so
   * the current state is read first and the toggle is sent only when it differs.
   * Resolves to the final state reported by Jenkins.
   */
  async setBuildKeepForever(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    keep: boolean
  ): Promise<boolean> {
    return this.runBuildMutation(
      environment,
      buildUrl,
      async (client) => (await applyBuildKeepForever(client, buildUrl, keep)).value
    );
  }

  async setBuildDescription(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    description: string
  ): Promise<void> {
    await this.runBuildMutation(environment, buildUrl, (client) =>
      client.submitBuildDescription(buildUrl, description)
    );
  }

  /**
   * Jenkins sets the display name and description together, so the current
   * description is read fresh and sent back unchanged. An empty display name
   * resets the build to its default "#N" label.
   */
  async setBuildDisplayName(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    displayName: string
  ): Promise<void> {
    await this.runBuildMutation(environment, buildUrl, async (client) => {
      const details = await client.getBuildDetails(buildUrl, { managementOnly: true });
      await client.submitBuildDisplayName(buildUrl, displayName, details.description ?? "");
    });
  }

  async getBuildManagementState(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsBuildManagementState> {
    const details = await this.runBuildAction(environment, (client) =>
      client.getBuildDetails(buildUrl, { managementOnly: true })
    );
    return {
      number: details.number,
      building: Boolean(details.building),
      keepLog: Boolean(details.keepLog),
      displayName: details.displayName ?? undefined,
      description: details.description ?? undefined
    };
  }

  async quickReplayBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    await this.runBuildAction(environment, (client) => client.quickReplayBuild(buildUrl));
  }

  async getReplayDefinition(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsReplayDefinition> {
    return this.runBuildAction(environment, (client) => client.getReplayDefinition(buildUrl));
  }

  async runReplay(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    payload: JenkinsReplaySubmissionPayload
  ): Promise<JenkinsReplayResult> {
    return this.runBuildAction(environment, (client) => client.runReplay(buildUrl, payload));
  }

  async rebuildBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    await this.runBuildAction(environment, (client) => client.rebuildBuild(buildUrl));
  }

  async getRestartFromStageInfo(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsRestartFromStageInfo> {
    return this.runBuildAction(environment, (client) => client.getRestartFromStageInfo(buildUrl));
  }

  async restartPipelineFromStage(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    stageName: string
  ): Promise<void> {
    await this.runBuildAction(environment, (client) =>
      client.restartPipelineFromStage(buildUrl, stageName)
    );
  }

  private async runBuildMutation<T>(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    action: (client: JenkinsClient) => Promise<T>
  ): Promise<T> {
    try {
      return await this.runBuildAction(environment, action);
    } finally {
      await this.invalidateBuildDetailsCache(environment, buildUrl);
    }
  }

  private async invalidateBuildDetailsCache(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<void> {
    try {
      const cache = this.context.getCache();
      for (const kind of BUILD_DETAILS_CACHE_KINDS) {
        cache.delete(await this.context.buildCacheKey(environment, kind, buildUrl));
      }
    } catch {
      // Cache cleanup is best effort; callers refresh the environment afterwards.
    }
  }

  private async runBuildAction<T>(
    environment: JenkinsEnvironmentRef,
    action: (client: JenkinsClient) => Promise<T>
  ): Promise<T> {
    const client = await this.context.getClient(environment);
    try {
      return await action(client);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }
}

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
import { callOptionalBuildEndpoint, toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type {
  BuildParameterPayload,
  ConsoleTextResult,
  ConsoleTextTailResult,
  FlowNodeDetailsResult,
  FlowNodeLogResult,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult
} from "./JenkinsDataTypes";

export class JenkinsBuildDataOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getBuildsForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    limit: number,
    options?: {
      detailLevel?: "summary" | "details";
      includeParameters?: boolean;
      bypassCache?: boolean;
    }
  ): Promise<JenkinsBuild[]> {
    const detailLevel = options?.detailLevel ?? "summary";
    const includeParameters = options?.includeParameters ?? false;
    const bypassCache = options?.bypassCache ?? false;
    const client = await this.context.getClient(environment);
    if (bypassCache) {
      return client.getBuilds(jobUrl, limit, {
        includeDetails: detailLevel === "details",
        includeParameters
      });
    }
    const cacheKind = `builds-${detailLevel}-${includeParameters ? "params" : "noparams"}-${limit}`;
    const cacheKey = await this.context.buildCacheKey(environment, cacheKind, jobUrl);
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        return client.getBuilds(jobUrl, limit, {
          includeDetails: detailLevel === "details",
          includeParameters
        });
      },
      this.context.getCacheTtlMs()
    );
  }

  async getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { includeCauses?: boolean; includeParameters?: boolean; statusOnly?: boolean }
  ): Promise<JenkinsBuildDetails> {
    const cacheKind = options?.statusOnly
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
    if (cached && !cached.building) {
      return cached;
    }

    const client = await this.context.getClient(environment);
    try {
      const details = await client.getBuildDetails(buildUrl, options);
      if (!details.building) {
        this.context.getCache().set(cacheKey, details, this.context.getCacheTtlMs());
      } else {
        this.context.getCache().delete(cacheKey);
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
    const client = await this.context.getClient(environment);
    try {
      return await client.getWorkflowRun(buildUrl);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        this.context.getCache().set(unsupportedKey, true, this.context.getCacheTtlMs());
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

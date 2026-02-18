import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsBuildTriggerOptions,
  JenkinsRestartFromStageInfo,
  JenkinsWorkflowRun
} from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";
import { JenkinsRequestError } from "../errors";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "../request";
import type { JenkinsTestReport } from "../types";
import { toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type {
  BuildParameterPayload,
  ConsoleTextResult,
  ConsoleTextTailResult,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult
} from "./JenkinsDataTypes";

export class JenkinsBuildDataOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getBuildsForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    limit: number,
    options?: { detailLevel?: "summary" | "details"; includeParameters?: boolean }
  ): Promise<JenkinsBuild[]> {
    const detailLevel = options?.detailLevel ?? "summary";
    const includeParameters = options?.includeParameters ?? false;
    const cacheKind = `builds-${detailLevel}-${includeParameters ? "params" : "noparams"}`;
    const cacheKey = await this.context.buildCacheKey(environment, cacheKind, jobUrl);
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
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
    buildUrl: string
  ): Promise<JenkinsBuildDetails> {
    const cacheKey = await this.context.buildCacheKey(environment, "build-details", buildUrl);
    const cached = this.context.getCache().get<JenkinsBuildDetails>(cacheKey);
    if (cached && !cached.building) {
      return cached;
    }

    const client = await this.context.getClient(environment);
    try {
      const details = await client.getBuildDetails(buildUrl);
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
    const client = await this.context.getClient(environment);
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
    const client = await this.context.getClient(environment);
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
    const client = await this.context.getClient(environment);
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
    const client = await this.context.getClient(environment);
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
    const client = await this.context.getClient(environment);
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
    const client = await this.context.getClient(environment);
    try {
      return await client.getTestReport(buildUrl, options);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        return undefined;
      }
      throw toBuildActionError(error);
    }
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
    const client = await this.context.getClient(environment);
    try {
      return await client.triggerBuild(jobUrl, options);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async stopBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.stopBuild(buildUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async replayBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.replayBuild(buildUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async rebuildBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    const client = await this.context.getClient(environment);
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
    const client = await this.context.getClient(environment);
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
    const client = await this.context.getClient(environment);
    try {
      await client.restartPipelineFromStage(buildUrl, stageName);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }
}
